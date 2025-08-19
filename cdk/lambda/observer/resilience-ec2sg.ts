import { Context } from "aws-lambda";
import * as AWS from "aws-sdk";

// AWS SDKクライアントの初期化
const ec2 = new AWS.EC2();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

interface SfnParallelEvent {
  gameId: string;
}

/**
 * EC2に付与されているセキュリティグループがインバウンドにALBからポート8080の通信許可が設定されているかを判定する
 * @param ec2SecurityGroupIds EC2のセキュリティグループIDの配列
 * @param albSecurityGroupId ALBのセキュリティグループID
 * @returns 少なくとも一つのEC2でALBからの通信が許可されていない場合はtrue、すべて許可されている場合はfalse
 */
async function checkEc2SecurityGroups(
  ec2SecurityGroupIds: string[],
  albSecurityGroupId: string,
): Promise<boolean> {
  try {
    const params = {
      GroupIds: ec2SecurityGroupIds,
    };

    const response = await ec2.describeSecurityGroups(params).promise();

    if (!response.SecurityGroups || response.SecurityGroups.length === 0) {
      console.error(`No security groups found for the provided IDs`);
      return true; // セキュリティグループが見つからない場合は問題ありと判断
    }

    // 各セキュリティグループをチェック
    for (const securityGroup of response.SecurityGroups) {
      let hasValidRule = false;

      // インバウンドルールをチェック
      for (const rule of securityGroup.IpPermissions || []) {
        // ポート8080のルールを探す
        if (rule.FromPort === 8080 || rule.ToPort === 8080) {
          // ALBのセキュリティグループからのアクセスが許可されているかチェック
          for (const userIdGroupPair of rule.UserIdGroupPairs || []) {
            if (userIdGroupPair.GroupId === albSecurityGroupId) {
              hasValidRule = true;
              break;
            }
          }
        }

        if (hasValidRule) {
          break;
        }
      }

      if (!hasValidRule) {
        console.log(
          `Security group ${securityGroup.GroupId} does not allow traffic from ALB on port 8080`,
        );
        return true; // 少なくとも一つのセキュリティグループで問題あり
      }
    }

    return false; // すべてのセキュリティグループで問題なし
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
    console.log("Checking EC2 security groups for ALB traffic allowance...");

    // リソースマッピングテーブルからセキュリティグループIDを取得
    const ec2SecurityGroupIds = await getEc2SecurityGroupIds();
    const albSecurityGroupId = await getAlbSecurityGroupId();

    // セキュリティグループの設定をチェック
    const hasIssue = await checkEc2SecurityGroups(
      ec2SecurityGroupIds,
      albSecurityGroupId,
    );

    // DynamoDBを更新
    const currentState = hasIssue ? "Red" : "Green";
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
