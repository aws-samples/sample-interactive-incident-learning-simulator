import { Context } from "aws-lambda";
import * as AWS from "aws-sdk";

// AWS SDKクライアントの初期化
const ec2 = new AWS.EC2();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

interface SfnParallelEvent {
  gameId: string;
}

/**
 * ALBに付与されているセキュリティグループがインバウンドに0.0.0.0/0からHTTPの通信許可が設定されているかを判定する
 * @param securityGroupId セキュリティグループID
 * @returns 0.0.0.0/0からのHTTP通信が許可されていない場合はtrue、許可されている場合はfalse
 */
async function checkAlbSecurityGroup(
  securityGroupId: string,
): Promise<boolean> {
  try {
    const params = {
      GroupIds: [securityGroupId],
    };

    const response = await ec2.describeSecurityGroups(params).promise();

    if (!response.SecurityGroups || response.SecurityGroups.length === 0) {
      console.error(`Security group ${securityGroupId} not found`);
      return true; // セキュリティグループが見つからない場合は問題ありと判断
    }

    const securityGroup = response.SecurityGroups[0];

    // インバウンドルールをチェック
    for (const rule of securityGroup.IpPermissions || []) {
      // HTTPポート(80)のルールを探す
      if (rule.FromPort === 80 || rule.ToPort === 80) {
        // 0.0.0.0/0からのアクセスが許可されているかチェック
        for (const ipRange of rule.IpRanges || []) {
          if (ipRange.CidrIp === "0.0.0.0/0") {
            return false; // 問題なし
          }
        }
      }
    }

    return true; // 0.0.0.0/0からのHTTPアクセスが許可されていない
  } catch (error) {
    console.error(`Error checking ALB security group: ${error}`);
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
    const resilienceScenarioTableName =
      process.env.RESILIENCE_SCENARIO_TABLE_NAME || "ResilienceScenarioTable";

    const params = {
      TableName: resilienceScenarioTableName,
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
 * リソースマッピングテーブルからALBのセキュリティグループIDを取得する
 * @returns セキュリティグループID
 */
async function getAlbSecurityGroupId(): Promise<string> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const params = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "ALB_SG",
      },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item || !result.Item.ResourceId) {
      throw new Error(
        "ALB security group ID not found in resource mapping table",
      );
    }

    return result.Item.ResourceId;
  } catch (error) {
    console.error(`Error getting ALB security group ID: ${error}`);
    throw error;
  }
}

export const handler = async (event: SfnParallelEvent, context: Context) => {
  try {
    console.log("Checking ALB security group for HTTP traffic allowance...");

    // リソースマッピングテーブルからALBのセキュリティグループIDを取得
    const securityGroupId = await getAlbSecurityGroupId();

    // セキュリティグループの設定をチェック
    const hasIssue = await checkAlbSecurityGroup(securityGroupId);

    // DynamoDBを更新
    const currentState = hasIssue ? "Red" : "Green";
    await updateDynamoDBState("ALB SG", currentState);

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
