import { Context } from "aws-lambda";
import * as AWS from "aws-sdk";

// AWS SDKクライアントの初期化
const ec2 = new AWS.EC2();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

interface SfnParallelEvent {
  gameId: string;
}

/**
 * EC2インスタンスがシャットダウンされているかどうかを判定する
 * @param instanceIds EC2インスタンスIDの配列
 * @returns 少なくとも一つのインスタンスがシャットダウンされている場合はtrue、そうでない場合はfalse
 */
async function checkEc2Status(instanceIds: string[]): Promise<boolean> {
  try {
    // インスタンスの詳細情報を取得
    const describeParams = {
      InstanceIds: instanceIds,
    };

    const response = await ec2.describeInstances(describeParams).promise();

    if (!response.Reservations || response.Reservations.length === 0) {
      console.error("No EC2 instances found");
      return false;
    }

    // 各インスタンスのステータスをチェック
    for (const reservation of response.Reservations) {
      for (const instance of reservation.Instances || []) {
        // インスタンスの状態をチェック
        // 'running' 以外の状態（'stopped', 'stopping', 'terminated'など）はシャットダウンとみなす
        if (instance.State && instance.State.Name !== "running") {
          console.log(
            `Instance ${instance.InstanceId} is not running. Current state: ${instance.State.Name}`,
          );
          return true; // シャットダウンされたインスタンスが見つかった
        }
      }
    }

    return false; // すべてのインスタンスが正常に稼働している
  } catch (error) {
    console.error(`Error checking EC2 status: ${error}`);
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
 * リソースマッピングテーブルからEC2インスタンスIDを取得する
 * @returns EC2インスタンスIDの配列
 */
async function getEc2InstanceIds(): Promise<string[]> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";
    const instanceIds: string[] = [];

    // EC2_INSTANCE_1を取得
    const params1 = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "EC2_INSTANCE_1",
      },
    };

    const result1 = await dynamoDB.get(params1).promise();
    if (result1.Item && result1.Item.ResourceId) {
      instanceIds.push(result1.Item.ResourceId);
    }

    // EC2_INSTANCE_2を取得
    const params2 = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "EC2_INSTANCE_2",
      },
    };

    const result2 = await dynamoDB.get(params2).promise();
    if (result2.Item && result2.Item.ResourceId) {
      instanceIds.push(result2.Item.ResourceId);
    }

    if (instanceIds.length === 0) {
      throw new Error("EC2 instance IDs not found in resource mapping table");
    }

    console.log(`Retrieved EC2 instance IDs: ${instanceIds.join(", ")}`);
    return instanceIds;
  } catch (error) {
    console.error(`Error getting EC2 instance IDs: ${error}`);
    throw error;
  }
}

export const handler = async (event: SfnParallelEvent, context: Context) => {
  try {
    console.log("Checking EC2 instances for shutdown status...");

    // リソースマッピングテーブルからEC2インスタンスIDを取得
    const instanceIds = await getEc2InstanceIds();

    // EC2インスタンスのステータスをチェック
    const isShutdown = await checkEc2Status(instanceIds);

    // DynamoDBを更新
    // シャットダウンされている場合は "Red"、そうでない場合は "Green"
    const currentState = isShutdown ? "Red" : "Green";
    await updateDynamoDBState("EC2", currentState);

    // レスポンスを返す
    // CurrentStateが "Green" の場合は solved: true、"Red" の場合は solved: false
    const response = {
      solved: currentState === "Green",
    };

    return response;
  } catch (error) {
    console.error(`Error in handler: ${error}`);
    throw error;
  }
};
