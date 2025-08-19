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
 * レジリエンスシナリオのEasyモード用Lambda関数
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

    // 3. ランダムに1つのコンポーネントを選択
    const selectedComponent =
      components[Math.floor(Math.random() * components.length)];
    console.log("Selected component:", selectedComponent);

    // 4. 選択したコンポーネントに対応するリソース情報を取得
    const resourceType = mapComponentToResourceType(
      selectedComponent.ComponentName,
    );
    const resourceInfo = await getResourceInfo(
      resourceMappingTableName,
      resourceType,
    );

    if (!resourceInfo || !resourceInfo.ResourceId) {
      throw new Error(`Resource information not found for ${resourceType}`);
    }

    // 5. 実際のAWSリソースに障害を発生させる
    await injectFailure(
      resourceType,
      resourceInfo.ResourceId,
      selectedComponent.ComponentName,
    );
    console.log(
      `Injected failure to ${resourceType} with ID ${resourceInfo.ResourceId}`,
    );

    // 6. 選択したコンポーネントの状態をRedに更新
    await updateComponentState(
      resilienceTableName,
      selectedComponent.ComponentName,
      "Red",
    );

    // 7. ゲームの状態をOngoingに更新
    await updateGameState(gameStateTableName, "Ongoing");

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Resilience Easy scenario started successfully",
        component: selectedComponent.ComponentName,
      }),
    };
  } catch (error: any) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Error starting resilience easy scenario",
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
  resourceType: string,
  resourceId: string,
  componentName: string,
): Promise<void> {
  // ダミーIDの場合はモックとして扱い、実際のAPI呼び出しをスキップ
  if (
    resourceId === "i-dummy" ||
    resourceId.startsWith("dummy-") ||
    resourceId.startsWith("sg-dummy")
  ) {
    console.log(
      `[MOCK] Simulating failure injection for ${resourceType} with dummy ID ${resourceId}`,
    );
    return;
  }

  switch (resourceType) {
    case "EC2_INSTANCE_1":
    case "EC2_INSTANCE_2":
      // EC2インスタンスをシャットダウン - 両方のインスタンスを停止するように変更
      await stopBothEC2Instances();
      break;
    case "ALB_SG":
      // ALBのセキュリティグループからHTTPインバウンドルールを削除
      await removeHTTPInboundRule(resourceId);
      break;
    case "EC2_SG":
      // EC2のセキュリティグループからALBからのインバウンドルールを削除
      await removeALBInboundRule(resourceId);
      break;
    case "EC2_PROCESS":
      // EC2上のアプリケーションプロセスをKill - ランダムに1台選択
      await killRandomApplicationProcess(resourceId);
      break;
    default:
      throw new Error(`Unsupported resource type: ${resourceType}`);
  }
}

/**
 * EC2インスタンスに障害を注入する関数
 * 両方のEC2インスタンスを停止
 */
async function injectEC2Failure(resourceId: string): Promise<void> {
  // 両方のEC2インスタンスを停止する関数を呼び出す
  await stopBothEC2Instances();
}

/**
 * EC2インスタンスを停止する関数
 */
async function stopBothEC2Instances(): Promise<void> {
  // 2台のEC2インスタンス情報を取得
  const resourceMappingTableName =
    process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";
  const ec2Instance1 = await getResourceInfo(
    resourceMappingTableName,
    "EC2_INSTANCE_1",
  );
  const ec2Instance2 = await getResourceInfo(
    resourceMappingTableName,
    "EC2_INSTANCE_2",
  );

  if (!ec2Instance1 || !ec2Instance1.ResourceId) {
    throw new Error("EC2 Instance 1 information not found");
  }

  if (!ec2Instance2 || !ec2Instance2.ResourceId) {
    throw new Error("EC2 Instance 2 information not found");
  }

  console.log(
    `Stopping both EC2 instances: ${ec2Instance1.ResourceId} and ${ec2Instance2.ResourceId}`,
  );

  try {
    // 両方のインスタンスを停止
    await stopEC2Instance(ec2Instance1.ResourceId);
    console.log(
      `Successfully stopped EC2 instance 1: ${ec2Instance1.ResourceId}`,
    );
  } catch (error) {
    console.error(`Error stopping EC2 instance 1: ${error}`);
    // エラーが発生しても処理を続行
    console.log("Continuing with EC2 instance stop simulation for instance 1");
  }

  try {
    await stopEC2Instance(ec2Instance2.ResourceId);
    console.log(
      `Successfully stopped EC2 instance 2: ${ec2Instance2.ResourceId}`,
    );
  } catch (error) {
    console.error(`Error stopping EC2 instance 2: ${error}`);
    // エラーが発生しても処理を続行
    console.log("Continuing with EC2 instance stop simulation for instance 2");
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
    console.log(
      `Successfully removed HTTP inbound rule from security group ${securityGroupId}`,
    );
  } catch (error: any) {
    // ルールが存在しない場合は無視
    if (error.name === "InvalidPermission.NotFound") {
      console.log("Security group rule already removed or does not exist");
    } else {
      console.error(`Error removing HTTP inbound rule: ${error.message}`);
      // エラーが発生しても処理を続行
      console.log("Continuing with security group rule removal simulation");
    }
  }
}

/**
 * EC2のセキュリティグループからALBからのインバウンドルールを削除する関数
 */
async function removeALBInboundRule(securityGroupId: string): Promise<void> {
  try {
    // ALBのセキュリティグループIDを取得
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";
    const albSgInfo = await getResourceInfo(resourceMappingTableName, "ALB_SG");

    if (!albSgInfo || !albSgInfo.ResourceId) {
      console.error(
        "ALB Security Group information not found, using environment variable as fallback",
      );
      // 環境変数からのフォールバック
      const albSecurityGroupId = process.env.ALB_SECURITY_GROUP_ID;
      if (!albSecurityGroupId) {
        throw new Error("ALB Security Group ID not found");
      }

      await removeInboundRule(securityGroupId, albSecurityGroupId);
      return;
    }

    await removeInboundRule(securityGroupId, albSgInfo.ResourceId);
  } catch (error: any) {
    // ルールが存在しない場合は無視
    if (error.name === "InvalidPermission.NotFound") {
      console.log("Security group rule already removed or does not exist");
    } else {
      console.error(`Error removing ALB inbound rule: ${error.message}`);
      // エラーが発生しても処理を続行
      console.log("Continuing with security group rule removal simulation");
    }
  }
}

/**
 * セキュリティグループからインバウンドルールを削除する関数
 */
async function removeInboundRule(
  securityGroupId: string,
  sourceGroupId: string,
): Promise<void> {
  try {
    const command = new RevokeSecurityGroupIngressCommand({
      GroupId: securityGroupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 8080,
          ToPort: 8080,
          UserIdGroupPairs: [{ GroupId: sourceGroupId }],
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
 * ランダムなEC2インスタンス上のアプリケーションプロセスをKillする関数
 */
async function killRandomApplicationProcess(serviceId: string): Promise<void> {
  // Easyモードでも両方のインスタンスでプロセスを停止するように変更
  const resourceMappingTableName =
    process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";
  const ec2Instance1 = await getResourceInfo(
    resourceMappingTableName,
    "EC2_INSTANCE_1",
  );
  const ec2Instance2 = await getResourceInfo(
    resourceMappingTableName,
    "EC2_INSTANCE_2",
  );

  if (!ec2Instance1 || !ec2Instance1.ResourceId) {
    throw new Error("EC2 Instance 1 information not found");
  }

  if (!ec2Instance2 || !ec2Instance2.ResourceId) {
    throw new Error("EC2 Instance 2 information not found");
  }

  console.log(
    `Stopping application processes on both EC2 instances: ${ec2Instance1.ResourceId} and ${ec2Instance2.ResourceId}`,
  );

  try {
    // 両方のインスタンス上のプロセスを停止
    await killApplicationProcess(ec2Instance1.ResourceId, "demoapp");
    console.log(
      `Successfully stopped process on EC2 instance 1: ${ec2Instance1.ResourceId}`,
    );
  } catch (error) {
    console.error(`Error stopping process on EC2 instance 1: ${error}`);
    // エラーが発生しても処理を続行
    console.log("Continuing with process stop simulation for instance 1");
  }

  try {
    await killApplicationProcess(ec2Instance2.ResourceId, "demoapp");
    console.log(
      `Successfully stopped process on EC2 instance 2: ${ec2Instance2.ResourceId}`,
    );
  } catch (error) {
    console.error(`Error stopping process on EC2 instance 2: ${error}`);
    // エラーが発生しても処理を続行
    console.log("Continuing with process stop simulation for instance 2");
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
      // EC2が選択された場合、両方のインスタンスを停止するため、どちらかのIDを返す
      // 実際の処理はstopBothEC2Instances()で両方のインスタンスを停止する
      return "EC2_INSTANCE_1";
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
