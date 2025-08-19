import { Context } from "aws-lambda";
import * as AWS from "aws-sdk";

// AWS SDKクライアントの初期化
const s3 = new AWS.S3();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

interface SfnParallelEvent {
  gameId: string;
}

/**
 * S3バケットのパブリックアクセスブロック設定を確認する
 * @param bucketName S3バケット名
 * @returns パブリックアクセスブロックがOFFの場合はtrue、ONの場合はfalse
 */
async function checkS3PublicAccessBlock(bucketName: string): Promise<boolean> {
  try {
    const params = {
      Bucket: bucketName,
    };

    try {
      const response = await s3.getPublicAccessBlock(params).promise();

      // PublicAccessBlockConfigurationのすべての設定がtrueの場合、パブリックアクセスはブロックされている
      const config = response.PublicAccessBlockConfiguration;
      if (config) {
        const isFullyBlocked =
          config.BlockPublicAcls &&
          config.BlockPublicPolicy &&
          config.IgnorePublicAcls &&
          config.RestrictPublicBuckets;

        return !isFullyBlocked; // パブリックアクセスブロックがOFFの場合はtrue
      }

      return true; // 設定が見つからない場合は脆弱と判断
    } catch (error: any) {
      // NoSuchPublicAccessBlockConfigurationエラーの場合、パブリックアクセスブロックが設定されていない
      if (error.code === "NoSuchPublicAccessBlockConfiguration") {
        return true; // パブリックアクセスブロックがOFFの場合はtrue
      }
      throw error;
    }
  } catch (error: any) {
    console.error(`Error checking S3 public access block: ${error}`);
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
  } catch (error: any) {
    console.error(`Error updating DynamoDB: ${error}`);
    throw error;
  }
}

/**
 * リソースマッピングテーブルからS3バケット名を取得する
 * @returns S3バケット名
 */
async function getS3BucketName(): Promise<string> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const params = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "S3_BUCKET",
      },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item || !result.Item.ResourceId) {
      throw new Error("S3 bucket name not found in resource mapping table");
    }

    return result.Item.ResourceId;
  } catch (error: any) {
    console.error(`Error getting S3 bucket name: ${error}`);
    throw error;
  }
}

export const handler = async (event: SfnParallelEvent, context: Context) => {
  try {
    console.log("Checking S3 bucket for public access block configuration...");

    // リソースマッピングテーブルからS3バケット名を取得
    const bucketName = await getS3BucketName();

    // S3バケットのパブリックアクセスブロック設定をチェック
    const isPublicAccessBlockOff = await checkS3PublicAccessBlock(bucketName);

    // DynamoDBを更新
    const currentState = isPublicAccessBlockOff ? "Red" : "Green";
    await updateDynamoDBState("S3", currentState);

    // レスポンスを返す
    const response = {
      solved: currentState === "Green",
    };

    return response;
  } catch (error: any) {
    console.error(`Error in handler: ${error}`);
    throw error;
  }
};
