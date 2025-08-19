import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { injectVulnerability } from "./utils/vulnerability-injector";
import { ResourceHelper } from "./utils/resource-helper";

// AWS SDKクライアントの初期化
const dynamoClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

// CORSヘッダーの定義
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
};

/**
 * セキュリティシナリオのHardモード用Lambda関数
 */
export const handler = async (event: any, context: any) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    const gameStateTableName =
      process.env.GAME_STATE_TABLE_NAME || "GameStateTable";
    const securityTableName =
      process.env.SECURITY_SCENARIO_TABLE_NAME || "SecurityScenarioTable";
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";
    const stackName = process.env.STACK_NAME || "InteractiveIncidentLearningSimulatorStack";

    // リソースヘルパーの初期化
    const resourceHelper = new ResourceHelper(
      resourceMappingTableName,
      stackName,
    );

    // 1. ゲームの状態を確認
    const gameState = await getGameState(gameStateTableName);

    // ゲームの状態がReadyでない場合はエラーを返す
    if (gameState !== "Ready") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: `Game is not ready to start. Current state: ${gameState}`,
        }),
      };
    }

    // 2. セキュリティシナリオのコンポーネント一覧を取得
    const components = await getComponents(securityTableName);

    // 3. 全てのコンポーネントに脆弱性を発生させる
    for (const component of components) {
      // コンポーネントに対応するリソース情報を取得
      const resourceType = resourceHelper.mapComponentToResourceType(
        component.ComponentName,
      );
      const outputKey = resourceHelper.mapResourceTypeToOutputKey(resourceType);

      try {
        // リソース情報を取得（DynamoDBまたはCloudFormation出力から）
        const resourceInfo = await resourceHelper.getResourceInfo(resourceType);

        // 実際のAWSリソースに脆弱性を発生させる
        await injectVulnerability(resourceType, resourceInfo);
        console.log(
          `Injected vulnerability to ${resourceType} with ID ${resourceInfo?.ResourceId}`,
        );

        // コンポーネントの状態をRedに更新
        await updateComponentState(
          securityTableName,
          component.ComponentName,
          "Red",
        );
      } catch (error) {
        console.error(
          `Error injecting vulnerability to ${component.ComponentName}: ${error}`,
        );
        // エラーが発生しても処理を続行
      }
    }

    // 4. ゲームの状態をOngoingに更新
    await updateGameState(gameStateTableName, "Ongoing");

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Security Hard scenario started successfully",
      }),
    };
  } catch (error: any) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Error starting security hard scenario",
        error: error.message,
      }),
    };
  }
};

/**
 * DynamoDBテーブルからゲームの状態を取得する関数
 */
async function getGameState(tableName: string) {
  const params = {
    TableName: tableName,
    Key: {
      GameId: "default",
    },
  };

  const command = new GetCommand(params);
  const result = await dynamoDB.send(command);
  return result.Item?.State;
}

/**
 * DynamoDBテーブルからコンポーネント一覧を取得する関数
 */
async function getComponents(tableName: string) {
  const params = {
    TableName: tableName,
  };

  const command = new ScanCommand(params);
  const result = await dynamoDB.send(command);
  return result.Items || [];
}

/**
 * コンポーネントの状態を更新する関数
 */
async function updateComponentState(
  tableName: string,
  componentName: string,
  state: "Green" | "Red",
) {
  const params = {
    TableName: tableName,
    Key: {
      ComponentName: componentName,
    },
    UpdateExpression: "SET CurrentState = :state",
    ExpressionAttributeValues: {
      ":state": state,
    },
  };

  const command = new UpdateCommand(params);
  await dynamoDB.send(command);
}

/**
 * ゲームの状態を更新する関数
 */
async function updateGameState(
  tableName: string,
  state: "Ready" | "Ongoing" | "Resetting",
) {
  const params = {
    TableName: tableName,
    Key: {
      GameId: "default",
    },
    UpdateExpression: "SET #state = :state",
    ExpressionAttributeNames: {
      "#state": "State",
    },
    ExpressionAttributeValues: {
      ":state": state,
    },
  };

  const command = new UpdateCommand(params);
  await dynamoDB.send(command);
}
