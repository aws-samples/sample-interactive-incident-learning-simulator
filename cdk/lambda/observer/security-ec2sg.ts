import { Context } from "aws-lambda";
import * as AWS from "aws-sdk";

// AWS SDKクライアントの初期化
const ec2 = new AWS.EC2();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

interface SfnParallelEvent {
  gameId: string;
}

/**
 * EC2に付与されているセキュリティグループがインバウンドに0.0.0.0/0からsshの通信許可が設定されているかを判定する
 * @param securityGroupIds セキュリティグループIDの配列
 * @returns 少なくとも一つのセキュリティグループで0.0.0.0/0からのSSH通信が許可されている場合はtrue、そうでない場合はfalse
 */
async function checkEc2SecurityGroups(
  securityGroupIds: string[],
): Promise<boolean> {
  try {
    const params = {
      GroupIds: securityGroupIds,
    };

    const response = await ec2.describeSecurityGroups(params).promise();

    if (!response.SecurityGroups || response.SecurityGroups.length === 0) {
      console.error(`No security groups found for the provided IDs`);
      return false;
    }

    // 少なくとも一つのセキュリティグループで脆弱性があるかチェック
    for (const securityGroup of response.SecurityGroups) {
      // インバウンドルールをチェック
      for (const rule of securityGroup.IpPermissions || []) {
        // SSHポート(22)のルールを探す
        if (rule.FromPort === 22 || rule.ToPort === 22) {
          // 0.0.0.0/0からのアクセスが許可されているかチェック
          for (const ipRange of rule.IpRanges || []) {
            if (ipRange.CidrIp === "0.0.0.0/0") {
              console.log(
                `Security group ${securityGroup.GroupId} has SSH vulnerability`,
              );
              return true; // 脆弱性あり
            }
          }
        }
      }
    }

    return false; // 脆弱性なし
  } catch (error) {
    console.error(`Error checking EC2 security groups: ${error}`);
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
 * リソースマッピングテーブルからEC2のセキュリティグループIDを取得する
 * @returns セキュリティグループIDの配列
 */
async function getEc2SecurityGroupIds(): Promise<string[]> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const params = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "EC2_SG",
      },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item || !result.Item.ResourceId) {
      throw new Error(
        "EC2 security group IDs not found in resource mapping table",
      );
    }

    // 単一のIDの場合は配列に変換、既に配列の場合はそのまま使用
    const resourceIds = Array.isArray(result.Item.ResourceId)
      ? result.Item.ResourceId
      : [result.Item.ResourceId];

    return resourceIds;
  } catch (error) {
    console.error(`Error getting EC2 security group IDs: ${error}`);
    throw error;
  }
}

export const handler = async (event: SfnParallelEvent, context: Context) => {
  try {
    console.log("Checking EC2 security groups for SSH vulnerability...");

    // リソースマッピングテーブルからEC2のセキュリティグループIDを取得
    const securityGroupIds = await getEc2SecurityGroupIds();

    // セキュリティグループの脆弱性をチェック
    const hasVulnerability = await checkEc2SecurityGroups(securityGroupIds);

    // DynamoDBを更新
    const currentState = hasVulnerability ? "Red" : "Green";
    await updateDynamoDBState("EC2 SG", currentState);

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
