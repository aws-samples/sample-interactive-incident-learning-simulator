import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  EC2Client,
  StopInstancesCommand,
  RevokeSecurityGroupIngressCommand,
} from "@aws-sdk/client-ec2";
import { SSMClient, SendCommandCommand } from "@aws-sdk/client-ssm";

// AWS SDKクライアントの初期化
const dynamoClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);
const ec2Client = new EC2Client({});
const ssmClient = new SSMClient({});

// CORSヘッダーの定義
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
};

/**
 * レジリエンスシナリオのHardモード用Lambda関数
 */
export const handler = async (event: any, context: any) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    const gameStateTableName =
      process.env.GAME_STATE_TABLE_NAME || "GameStateTable";
    const resilienceTableName =
      process.env.RESILIENCE_SCENARIO_TABLE_NAME || "ResilienceScenarioTable";
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

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

    // 2. レジリエンスシナリオのコンポーネント一覧を取得
    const components = await getComponents(resilienceTableName);

    // 3. 全てのコンポーネントに障害を発生させる
    const failedComponents = [];
    for (const component of components) {
      try {
        // EC2 Processコンポーネントはハードモードでは除外（READMEに基づく）
        if (component.ComponentName === "EC2 Process") {
          console.log("Skipping EC2 Process component in Hard mode");
          continue;
        }

        // コンポーネントに対応するリソース情報を取得
        const resourceType = mapComponentToResourceType(
          component.ComponentName,
        );

        // 実際のAWSリソースに障害を発生させる
        await injectFailure(
          resourceMappingTableName,
          resourceType,
          component.ComponentName,
        );
        console.log(`Injected failure to ${resourceType}`);

        // コンポーネントの状態をRedに更新
        await updateComponentState(
          resilienceTableName,
          component.ComponentName,
          "Red",
        );
        failedComponents.push(component.ComponentName);
      } catch (error) {
        console.error(
          `Error injecting failure to component ${component.ComponentName}:`,
          error,
        );
        // エラーが発生しても他のコンポーネントの処理を続行
      }
    }

    // 4. ゲームの状態をOngoingに更新
    await updateGameState(gameStateTableName, "Ongoing");

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Resilience Hard scenario started successfully",
        components: failedComponents,
      }),
    };
  } catch (error: any) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Error starting resilience hard scenario",
        error: error.message,
      }),
    };
  }
};

/**
 * 障害を注入する関数
 * コンポーネントに応じた障害を発生させる
 */
async function injectFailure(
  tableName: string,
  resourceType: string,
  componentName: string,
): Promise<void> {
  switch (resourceType) {
    case "EC2_INSTANCE":
      // EC2インスタンスをシャットダウン - Hardモードでは両方のインスタンスを停止
      await injectEC2Failure(tableName);
      break;
    case "ALB_SG":
      // ALBのセキュリティグループからHTTPインバウンドルールを削除
      const albSgInfo = await getResourceInfo(tableName, "ALB_SG");
      if (!albSgInfo || !albSgInfo.ResourceId) {
        throw new Error("ALB Security Group information not found");
      }
      await removeHTTPInboundRule(albSgInfo.ResourceId);
      break;
    case "EC2_SG":
      // EC2のセキュリティグループからALBからのインバウンドルールを削除
      const ec2SgInfo = await getResourceInfo(tableName, "EC2_SG");
      if (!ec2SgInfo || !ec2SgInfo.ResourceId) {
        throw new Error("EC2 Security Group information not found");
      }
      await removeALBInboundRule(ec2SgInfo.ResourceId, tableName);
      break;
    case "EC2_PROCESS":
      // EC2上のアプリケーションプロセスをKill - Hardモードでは両方のインスタンスで実行
      const processInfo = await getResourceInfo(tableName, "EC2_PROCESS");
      if (!processInfo || !processInfo.ResourceId) {
        throw new Error("EC2 Process information not found");
      }
      await killAllApplicationProcesses(tableName, processInfo.ResourceId);
      break;
    default:
      throw new Error(`Unsupported resource type: ${resourceType}`);
  }
}

/**
 * EC2インスタンスに障害を注入する関数
 * Hardモードでは両方のインスタンスを停止
 */
async function injectEC2Failure(tableName: string): Promise<void> {
  // 両方のEC2インスタンス情報を取得
  const ec2Instance1 = await getResourceInfo(tableName, "EC2_INSTANCE_1");
  const ec2Instance2 = await getResourceInfo(tableName, "EC2_INSTANCE_2");

  if (!ec2Instance1 || !ec2Instance1.ResourceId) {
    throw new Error("EC2 Instance 1 information not found");
  }

  if (!ec2Instance2 || !ec2Instance2.ResourceId) {
    throw new Error("EC2 Instance 2 information not found");
  }

  // 両方のインスタンスを停止
  console.log(
    `Stopping both EC2 instances: ${ec2Instance1.ResourceId} and ${ec2Instance2.ResourceId}`,
  );

  try {
    await stopEC2Instance(ec2Instance1.ResourceId);
    console.log(
      `Successfully stopped EC2 instance 1: ${ec2Instance1.ResourceId}`,
    );
  } catch (error) {
    console.error(`Error stopping EC2 instance 1: ${error}`);
  }

  try {
    await stopEC2Instance(ec2Instance2.ResourceId);
    console.log(
      `Successfully stopped EC2 instance 2: ${ec2Instance2.ResourceId}`,
    );
  } catch (error) {
    console.error(`Error stopping EC2 instance 2: ${error}`);
  }
}

/**
 * 全てのEC2インスタンス上のアプリケーションプロセスをKillする関数
 */
async function killAllApplicationProcesses(
  tableName: string,
  serviceId: string,
): Promise<void> {
  // 両方のEC2インスタンス情報を取得
  const ec2Instance1 = await getResourceInfo(tableName, "EC2_INSTANCE_1");
  const ec2Instance2 = await getResourceInfo(tableName, "EC2_INSTANCE_2");

  if (!ec2Instance1 || !ec2Instance1.ResourceId) {
    throw new Error("EC2 Instance 1 information not found");
  }

  if (!ec2Instance2 || !ec2Instance2.ResourceId) {
    throw new Error("EC2 Instance 2 information not found");
  }

  // 両方のインスタンス上のプロセスをKill
  console.log(
    `Killing application processes on both EC2 instances: ${ec2Instance1.ResourceId} and ${ec2Instance2.ResourceId}`,
  );

  try {
    await killApplicationProcess(ec2Instance1.ResourceId, serviceId);
    console.log(
      `Successfully killed process on EC2 instance 1: ${ec2Instance1.ResourceId}`,
    );
  } catch (error) {
    console.error(`Error killing process on EC2 instance 1: ${error}`);
  }

  try {
    await killApplicationProcess(ec2Instance2.ResourceId, serviceId);
    console.log(
      `Successfully killed process on EC2 instance 2: ${ec2Instance2.ResourceId}`,
    );
  } catch (error) {
    console.error(`Error killing process on EC2 instance 2: ${error}`);
  }
}

/**
 * EC2インスタンスを停止する関数
 */
async function stopEC2Instance(instanceId: string): Promise<void> {
  const command = new StopInstancesCommand({
    InstanceIds: [instanceId],
  });

  await ec2Client.send(command);
}

/**
 * ALBのセキュリティグループからHTTPインバウンドルールを削除する関数
 */
async function removeHTTPInboundRule(securityGroupId: string): Promise<void> {
  try {
    const command = new RevokeSecurityGroupIngressCommand({
      GroupId: securityGroupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 80,
          ToPort: 80,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
        },
      ],
    });

    await ec2Client.send(command);
  } catch (error: any) {
    // ルールが存在しない場合は無視
    if (error.name === "InvalidPermission.NotFound") {
      console.log("Security group rule already removed or does not exist");
    } else {
      throw error;
    }
  }
}

/**
 * EC2のセキュリティグループからALBからのインバウンドルールを削除する関数
 */
async function removeALBInboundRule(
  securityGroupId: string,
  tableName: string,
): Promise<void> {
  // ALBのセキュリティグループIDを取得
  const albSgInfo = await getResourceInfo(tableName, "ALB_SG");

  if (!albSgInfo || !albSgInfo.ResourceId) {
    throw new Error("ALB Security Group information not found");
  }

  try {
    const command = new RevokeSecurityGroupIngressCommand({
      GroupId: securityGroupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 8080,
          ToPort: 8080,
          UserIdGroupPairs: [{ GroupId: albSgInfo.ResourceId }],
        },
      ],
    });

    await ec2Client.send(command);
  } catch (error: any) {
    // ルールが存在しない場合は無視
    if (error.name === "InvalidPermission.NotFound") {
      console.log("Security group rule already removed or does not exist");
    } else {
      throw error;
    }
  }
}

/**
 * EC2上のアプリケーションプロセスをKillする関数
 */
async function killApplicationProcess(
  instanceId: string,
  serviceId: string,
): Promise<void> {
  // SSM Run Commandを使用してプロセスをKill
  try {
    const command = new SendCommandCommand({
      DocumentName: "AWS-RunShellScript",
      InstanceIds: [instanceId],
      Parameters: {
        commands: [
          // systemctl stop demoappを実行してサービスを停止
          `sudo systemctl stop demoapp || true`,
        ],
      },
    });

    await ssmClient.send(command);
  } catch (error: any) {
    // インスタンスIDが無効な場合など、エラーをログに記録して続行
    console.error(`Error executing SSM command: ${error.message}`);
    if (error.name === "ValidationException") {
      console.log(
        "Invalid instance ID or SSM not available. Simulating process stop.",
      );
    } else {
      throw error;
    }
  }
}

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

/**
 * コンポーネント名からリソースタイプへのマッピング関数
 */
function mapComponentToResourceType(componentName: string): string {
  switch (componentName) {
    case "EC2":
      return "EC2_INSTANCE"; // 実際の処理では EC2_INSTANCE_1 と EC2_INSTANCE_2 を使用
    case "ALB SG":
      return "ALB_SG";
    case "EC2 SG":
      return "EC2_SG";
    case "EC2 Process":
      return "EC2_PROCESS";
    default:
      return componentName;
  }
}

/**
 * リソース情報を取得する関数
 */
async function getResourceInfo(tableName: string, resourceType: string) {
  const params = {
    TableName: tableName,
    Key: {
      ResourceType: resourceType,
    },
  };

  const command = new GetCommand(params);
  const result = await dynamoDB.send(command);
  return result.Item;
}
