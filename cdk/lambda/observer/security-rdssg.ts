import { Context } from "aws-lambda";
import * as AWS from "aws-sdk";

// AWS SDKクライアントの初期化
const ec2 = new AWS.EC2();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

interface SfnParallelEvent {
  gameId: string;
}

/**
 * RDSに付与されているセキュリティグループがインバウンドに0.0.0.0/0からMySQLの通信許可が設定されているかを判定する
 * @param securityGroupId セキュリティグループID
 * @returns 0.0.0.0/0からのMySQL通信が許可されている場合はtrue、そうでない場合はfalse
 */
async function checkRdsSecurityGroup(
  securityGroupId: string,
): Promise<boolean> {
  try {
    const params = {
      GroupIds: [securityGroupId],
    };

    const response = await ec2.describeSecurityGroups(params).promise();

    if (!response.SecurityGroups || response.SecurityGroups.length === 0) {
      console.error(`Security group ${securityGroupId} not found`);
      return false;
    }

    const securityGroup = response.SecurityGroups[0];

    // インバウンドルールをチェック
    for (const rule of securityGroup.IpPermissions || []) {
      // MySQLポート(3306)のルールを探す
      if (rule.FromPort === 3306 || rule.ToPort === 3306) {
        // 0.0.0.0/0からのアクセスが許可されているかチェック
        for (const ipRange of rule.IpRanges || []) {
          if (ipRange.CidrIp === "0.0.0.0/0") {
            return true; // 脆弱性あり
          }
        }
      }
    }

    return false; // 脆弱性なし
  } catch (error) {
    console.error(`Error checking RDS security group: ${error}`);
    throw error;
  }
}

/**
 * DynamoDBのテーブルを更新する
 * @param componentName コンポーネント名
 * @param currentState 現在の状態 ('Green' or 'Red')
 */
async function updateDynamoDBState(
  componentName: string,
  currentState: "Green" | "Red",
): Promise<void> {
  try {
    const securityScenarioTableName =
      process.env.SECURITY_SCENARIO_TABLE_NAME || "SecurityScenarioTable";

    const params = {
      TableName: securityScenarioTableName,
      Key: {
        ComponentName: componentName,
      },
      UpdateExpression: "set CurrentState = :state",
      ExpressionAttributeValues: {
        ":state": currentState,
      },
    };

    await dynamoDB.update(params).promise();
    console.log(`Updated ${componentName} state to ${currentState}`);
  } catch (error) {
    console.error(`Error updating DynamoDB: ${error}`);
    throw error;
  }
}

/**
 * リソースマッピングテーブルからRDSのセキュリティグループIDを取得する
 * @returns セキュリティグループID
 */
async function getRdsSecurityGroupId(): Promise<string> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const params = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "RDS_SG",
      },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item || !result.Item.ResourceId) {
      throw new Error(
        "RDS security group ID not found in resource mapping table",
      );
    }

    return result.Item.ResourceId;
  } catch (error) {
    console.error(`Error getting RDS security group ID: ${error}`);
    throw error;
  }
}

export const handler = async (event: SfnParallelEvent, context: Context) => {
  try {
    console.log("Checking RDS security group for MySQL vulnerability...");

    // リソースマッピングテーブルからRDSのセキュリティグループIDを取得
    const securityGroupId = await getRdsSecurityGroupId();

    // セキュリティグループの脆弱性をチェック
    const hasVulnerability = await checkRdsSecurityGroup(securityGroupId);

    // DynamoDBを更新
    const currentState = hasVulnerability ? "Red" : "Green";
    await updateDynamoDBState("RDS SG", currentState);

    // レスポンスを返す
    const response = {
      solved: currentState === "Green",
    };

    return response;
  } catch (error) {
    console.error(`Error in handler: ${error}`);
    throw error;
  }
};
