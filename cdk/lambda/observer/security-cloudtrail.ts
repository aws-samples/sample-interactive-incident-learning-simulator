import { Context } from "aws-lambda";
import * as AWS from "aws-sdk";

// AWS SDKクライアントの初期化
const cloudTrail = new AWS.CloudTrail();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

interface SfnParallelEvent {
  gameId: string;
}

/**
 * CloudTrailの設定が有効になっているかを判定する
 * @returns CloudTrailが無効の場合はtrue、有効の場合はfalse
 */
async function checkCloudTrailStatus(cloudTrailArn: string): Promise<boolean> {
  try {
    // CloudTrailの一覧を取得
    const response = await cloudTrail.describeTrails().promise();

    if (!response.trailList || response.trailList.length === 0) {
      console.log("No CloudTrail trails found");
      return true; // CloudTrailが設定されていない場合は脆弱と判断
    }

    const statusParams = {
      Name: cloudTrailArn,
    };
    const statusResponse = await cloudTrail
      .getTrailStatus(statusParams)
      .promise();

    return !statusResponse.IsLogging;
  } catch (error) {
    console.error(`Error checking CloudTrail status: ${error}`);
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

async function getCloudTrailArn(): Promise<string> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const params = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "CLOUDTRAIL",
      },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item || !result.Item.ResourceId) {
      throw new Error("cloudtrail name not found in resource mapping table");
    }

    return result.Item.ResourceArn;
  } catch (error) {
    console.error(`Error getting cloudtrail name: ${error}`);
    throw error;
  }
}

export const handler = async (event: SfnParallelEvent, context: Context) => {
  try {
    console.log("Checking CloudTrail status...");

    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const cloudTrailName = await getCloudTrailArn();

    // CloudTrailの状態をチェック
    const isCloudTrailDisabled = await checkCloudTrailStatus(cloudTrailName);

    // DynamoDBを更新
    const currentState = isCloudTrailDisabled ? "Red" : "Green";
    await updateDynamoDBState("CloudTrail", currentState);

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
