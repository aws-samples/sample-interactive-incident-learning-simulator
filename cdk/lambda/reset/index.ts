import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ResourceHelper } from "../security/utils/resource-helper";
import {
  EC2Client,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
  DescribeSecurityGroupsCommand,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  SecurityGroup,
  DescribeIamInstanceProfileAssociationsCommand,
  ReplaceIamInstanceProfileAssociationCommand,
  ReplaceIamInstanceProfileAssociationCommandInput,
} from "@aws-sdk/client-ec2";
import {
  S3Client,
  PutPublicAccessBlockCommand,
  GetPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import {
  CloudTrailClient,
  StartLoggingCommand,
  UpdateTrailCommand,
  DescribeTrailsCommand,
  GetTrailStatusCommand,
} from "@aws-sdk/client-cloudtrail";
import {
  SFNClient,
  StartExecutionCommand,
  ListExecutionsCommand,
  StopExecutionCommand,
  ExecutionStatus,
} from "@aws-sdk/client-sfn";

// AWS SDKクライアントの初期化
const dynamoClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);
const ec2Client = new EC2Client({});
const s3Client = new S3Client({});
const cloudtrailClient = new CloudTrailClient({});
const sfnClient = new SFNClient({});

// CORSヘッダーの定義
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
};

/**
 * ゲームの状態をリセットするLambda関数
 * - CDKデプロイ直後の状態に戻す
 * - すべてのコンポーネントの状態をGreenに戻す
 * - GameStateテーブルの状態をReadyに戻す
 */
export const handler = async (event: any, context: any) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    const gameStateTableName =
      process.env.GAME_STATE_TABLE_NAME || "GameStateTable";
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    // 1. 実行中のStep Functionsを停止
    console.log("Stopping running Step Functions...");
    await stopRunningStepFunctions();

    // 現在のゲーム状態を確認
    const currentGameState = await getGameState(gameStateTableName);
    console.log("Current game state:", currentGameState);

    // すでにResetting状態の場合はエラーを返す
    if (currentGameState === "Resetting") {
      return {
        statusCode: 409, // Conflict
        headers: corsHeaders,
        body: JSON.stringify({
          message:
            "Reset operation is currently in progress. Please wait 5-15 minutes for completion.",
          status: "resetting",
          estimatedDuration: "5-15 minutes",
        }),
      };
    }

    // 2. セキュリティグループのリセット
    console.log("Resetting security groups...");
    await resetSecurityGroups(resourceMappingTableName);

    // 3. S3バケットのパブリックアクセスブロック設定を有効化
    console.log("Enabling S3 public access block...");
    await enableS3PublicAccessBlock(resourceMappingTableName);

    // 4. CloudTrailの有効化
    console.log("Enabling CloudTrail...");
    await enableCloudTrail(resourceMappingTableName);

    // 5. IAMロールの設定を初期状態に戻す
    console.log("Resetting IAM roles...");
    await resetIAMRole(resourceMappingTableName);

    // 6. EC2インスタンスの強制再起動を実行し、再起動開始時点でGameStateをResettingに変更
    console.log(
      "Starting EC2 force restart and setting game state to Resetting...",
    );
    await forceRestartEC2InstancesWithStateChange(
      resourceMappingTableName,
      gameStateTableName,
    );

    // 7. StepFunctionを起動して監視を開始
    console.log("Starting observation StepFunction...");
    await startObservationStateMachine();

    return {
      statusCode: 202,
      headers: corsHeaders,
      body: JSON.stringify({
        message:
          "Reset process initiated. AWS resources have been reset and EC2 instances are restarting. The system will automatically return to Ready state once all components are verified as healthy.",
      }),
    };
  } catch (error: any) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Error resetting game",
        error: error.message,
      }),
    };
  }
};

/**
 * ALBのセキュリティグループを取得
 */
async function getAlbSecurityGroup(
  resourceMappingTableName: string,
): Promise<SecurityGroup> {
  try {
    // リソースマッピングテーブルからALB SGの情報を取得
    const albSgInfo = await getResourceInfo(resourceMappingTableName, "ALB_SG");

    if (!albSgInfo || !albSgInfo.ResourceId) {
      throw new Error(
        "ALB Security Group information not found in resource mapping table",
      );
    }

    // セキュリティグループの詳細情報を取得
    const command = new DescribeSecurityGroupsCommand({
      GroupIds: [albSgInfo.ResourceId],
    });
    const response = await ec2Client.send(command);

    if (!response.SecurityGroups?.[0]) {
      throw new Error(`ALB Security Group ${albSgInfo.ResourceId} not found`);
    }

    return response.SecurityGroups[0];
  } catch (error) {
    console.error("Error getting ALB security group:", error);

    // フォールバック: CloudFormationタグを使用して検索
    const command = new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: "tag:aws:cloudformation:stack-name",
          Values: ["InteractiveIncidentLearningSimulatorStack"],
        },
        {
          Name: "tag:aws:cloudformation:logical-id",
          Values: ["*AlbSecurityGroup*"],
        },
      ],
    });
    const response = await ec2Client.send(command);

    if (!response.SecurityGroups?.[0]) {
      throw new Error("ALB Security Group not found");
    }

    return response.SecurityGroups[0];
  }
}

/**
 * EC2のセキュリティグループを取得
 */
async function getEc2SecurityGroup(
  resourceMappingTableName: string,
): Promise<any> {
  try {
    // リソースマッピングテーブルからEC2 SGの情報を取得
    const ec2SgInfo = await getResourceInfo(resourceMappingTableName, "EC2_SG");

    if (!ec2SgInfo || !ec2SgInfo.ResourceId) {
      throw new Error(
        "EC2 Security Group information not found in resource mapping table",
      );
    }

    // セキュリティグループの詳細情報を取得
    const command = new DescribeSecurityGroupsCommand({
      GroupIds: [ec2SgInfo.ResourceId],
    });
    const response = await ec2Client.send(command);

    if (!response.SecurityGroups?.[0]) {
      throw new Error(`EC2 Security Group ${ec2SgInfo.ResourceId} not found`);
    }

    return response.SecurityGroups[0];
  } catch (error) {
    console.error("Error getting EC2 security group:", error);

    // フォールバック: CloudFormationタグを使用して検索
    const command = new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: "tag:aws:cloudformation:stack-name",
          Values: ["InteractiveIncidentLearningSimulatorStack"],
        },
        {
          Name: "tag:aws:cloudformation:logical-id",
          Values: ["*WebappServiceEc2ServiceSecurityGroup*"],
        },
      ],
    });
    const response = await ec2Client.send(command);

    if (!response.SecurityGroups?.[0]) {
      throw new Error("EC2 Security Group not found");
    }

    return response.SecurityGroups[0];
  }
}

/**
 * RDSのセキュリティグループを取得
 */
async function getRdsSecurityGroup(
  resourceMappingTableName: string,
): Promise<any> {
  try {
    // リソースマッピングテーブルからRDS SGの情報を取得
    const rdsSgInfo = await getResourceInfo(resourceMappingTableName, "RDS_SG");

    if (!rdsSgInfo || !rdsSgInfo.ResourceId) {
      throw new Error(
        "RDS Security Group information not found in resource mapping table",
      );
    }

    // セキュリティグループの詳細情報を取得
    const command = new DescribeSecurityGroupsCommand({
      GroupIds: [rdsSgInfo.ResourceId],
    });
    const response = await ec2Client.send(command);

    if (!response.SecurityGroups?.[0]) {
      throw new Error(`RDS Security Group ${rdsSgInfo.ResourceId} not found`);
    }

    return response.SecurityGroups[0];
  } catch (error) {
    console.error("Error getting RDS security group:", error);

    // フォールバック: CloudFormationタグを使用して検索
    const command = new DescribeSecurityGroupsCommand({
      Filters: [
        {
          Name: "tag:aws:cloudformation:stack-name",
          Values: ["InteractiveIncidentLearningSimulatorStack"],
        },
        {
          Name: "tag:aws:cloudformation:logical-id",
          Values: ["*AuroraClusterSecurityGroup*"],
        },
      ],
    });
    const response = await ec2Client.send(command);

    if (!response.SecurityGroups?.[0]) {
      throw new Error("RDS Security Group not found");
    }

    return response.SecurityGroups[0];
  }
}

/**
 * ALBセキュリティグループをリセット
 */
async function resetAlbSecurityGroup(sg: any) {
  try {
    // 既存のインバウンドルールを削除
    if (sg.IpPermissions && sg.IpPermissions.length > 0) {
      const revokeCommand = new RevokeSecurityGroupIngressCommand({
        GroupId: sg.GroupId!,
        IpPermissions: sg.IpPermissions,
      });
      await ec2Client.send(revokeCommand);
    }

    // CDKで定義された正しいルールを追加
    const authorizeCommand = new AuthorizeSecurityGroupIngressCommand({
      GroupId: sg.GroupId!,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 80,
          ToPort: 80,
          IpRanges: [
            {
              CidrIp: "0.0.0.0/0",
              Description: "HTTP access from anywhere",
            },
          ],
        },
      ],
    });
    await ec2Client.send(authorizeCommand);

    console.log(`Reset ALB security group ${sg.GroupId} successfully`);
  } catch (error) {
    console.error("Error resetting ALB security group:", error);
    throw error;
  }
}

/**
 * EC2セキュリティグループをリセット
 */
async function resetEc2SecurityGroup(sg: any, albSg: any) {
  try {
    // 既存のインバウンドルールを削除
    if (sg.IpPermissions && sg.IpPermissions.length > 0) {
      const revokeCommand = new RevokeSecurityGroupIngressCommand({
        GroupId: sg.GroupId!,
        IpPermissions: sg.IpPermissions,
      });
      await ec2Client.send(revokeCommand);
    }

    // CDKで定義された正しいルールを追加（ALBからのポート8080アクセスを許可）
    const authorizeCommand = new AuthorizeSecurityGroupIngressCommand({
      GroupId: sg.GroupId!,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 8080,
          ToPort: 8080,
          UserIdGroupPairs: [
            {
              Description: "Load balancer to target",
              GroupId: albSg.GroupId!,
            },
          ],
        },
      ],
    });
    await ec2Client.send(authorizeCommand);

    console.log(`Reset EC2 security group ${sg.GroupId} successfully`);
  } catch (error) {
    console.error("Error resetting EC2 security group:", error);
    throw error;
  }
}

/**
 * RDSセキュリティグループをリセット
 */
async function resetRdsSecurityGroup(sg: any, ec2Sg: any) {
  try {
    // 既存のインバウンドルールを削除
    if (sg.IpPermissions && sg.IpPermissions.length > 0) {
      const revokeCommand = new RevokeSecurityGroupIngressCommand({
        GroupId: sg.GroupId!,
        IpPermissions: sg.IpPermissions,
      });
      await ec2Client.send(revokeCommand);
    }

    // CDKで定義された正しいルールを追加（EC2からのポート5432アクセスを許可）
    const authorizeCommand = new AuthorizeSecurityGroupIngressCommand({
      GroupId: sg.GroupId!,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 5432,
          ToPort: 5432,
          UserIdGroupPairs: [
            {
              Description: "EC2 to RDS",
              GroupId: ec2Sg.GroupId!,
            },
          ],
        },
      ],
    });
    await ec2Client.send(authorizeCommand);

    console.log(`Reset RDS security group ${sg.GroupId} successfully`);
  } catch (error) {
    console.error("Error resetting RDS security group:", error);
    throw error;
  }
}

/**
 * セキュリティグループをデプロイ直後の状態に戻す
 */
async function resetSecurityGroups(resourceMappingTableName: string) {
  try {
    // ALBのセキュリティグループをリセット
    const albSg = await getAlbSecurityGroup(resourceMappingTableName);
    await resetAlbSecurityGroup(albSg);

    // EC2のセキュリティグループをリセット
    const ec2Sg = await getEc2SecurityGroup(resourceMappingTableName);
    await resetEc2SecurityGroup(ec2Sg, albSg);

    // RDSのセキュリティグループをリセット
    const rdsSg = await getRdsSecurityGroup(resourceMappingTableName);
    await resetRdsSecurityGroup(rdsSg, ec2Sg);

    console.log("All security groups reset successfully");
  } catch (error) {
    console.error("Error resetting security groups:", error);
    throw error;
  }
}

/**
 * EC2インスタンスを強制再起動し、再起動開始時点でGameStateをResettingに変更
 */
async function forceRestartEC2InstancesWithStateChange(
  resourceMappingTableName: string,
  gameStateTableName: string,
) {
  try {
    // EC2インスタンス情報を取得
    const ec2Instance1 = await getResourceInfo(
      resourceMappingTableName,
      "EC2_INSTANCE_1",
    );
    const ec2Instance2 = await getResourceInfo(
      resourceMappingTableName,
      "EC2_INSTANCE_2",
    );

    const instances = [];
    if (ec2Instance1 && ec2Instance1.ResourceId) {
      instances.push(ec2Instance1.ResourceId);
    }
    if (ec2Instance2 && ec2Instance2.ResourceId) {
      instances.push(ec2Instance2.ResourceId);
    }

    // 環境変数からのフォールバック
    if (instances.length === 0) {
      const instanceId = process.env.MEMO_APP_INSTANCE_ID;
      if (instanceId) {
        console.log(
          "Using environment variable for EC2 instance ID:",
          instanceId,
        );
        instances.push(instanceId);
      } else {
        console.warn("No EC2 instance information found");
        return;
      }
    }

    // 各インスタンスの状態を確認し、必要に応じて停止処理を開始
    const restartPromises = instances.map(async (instanceId) => {
      console.log(`Processing EC2 instance: ${instanceId}`);
      await startEC2InstanceRestart(instanceId);
    });

    // すべてのインスタンスの再起動処理を並行実行
    await Promise.all(restartPromises);

    // すべてのEC2再起動処理が開始された時点でGameStateをResettingに変更
    console.log(
      "All EC2 restart processes initiated. Setting game state to Resetting...",
    );
    await updateGameState(gameStateTableName, "Resetting");
    console.log(
      "Game state set to Resetting. Step Functions will now monitor and eventually set state to Ready.",
    );
  } catch (error) {
    console.error(
      "Error in force restart EC2 instances with state change:",
      error,
    );
    throw error;
  }
}

/**
 * EC2インスタンスの再起動処理を開始する
 * 停止中の場合は停止完了を待ってから起動、実行中の場合は強制再起動
 */
async function startEC2InstanceRestart(instanceId: string) {
  try {
    // インスタンスの状態を確認
    const describeCommand = new DescribeInstancesCommand({
      InstanceIds: [instanceId],
    });
    const describeResult = await ec2Client.send(describeCommand);

    const instance = describeResult.Reservations?.[0]?.Instances?.[0];
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    const currentState = instance.State?.Name;
    console.log(`EC2 instance ${instanceId} current state: ${currentState}`);

    // 状態に応じた処理
    if (currentState === "running") {
      // 実行中の場合は強制再起動（停止→起動）
      console.log(
        `Starting force restart for running EC2 instance ${instanceId}`,
      );
      await forceRestartInstance(instanceId);
    } else if (currentState === "stopped") {
      // 停止中の場合は起動
      console.log(`Starting stopped EC2 instance ${instanceId}`);
      const startCommand = new StartInstancesCommand({
        InstanceIds: [instanceId],
      });
      await ec2Client.send(startCommand);
      console.log(`EC2 instance ${instanceId} start initiated`);
    } else if (currentState === "stopping") {
      // 停止中の場合は停止完了を待ってから起動
      console.log(
        `EC2 instance ${instanceId} is stopping, waiting for stop completion...`,
      );
      await waitForInstanceStopped(instanceId);
      console.log(`Starting EC2 instance ${instanceId} after stop completion`);
      const startCommand = new StartInstancesCommand({
        InstanceIds: [instanceId],
      });
      await ec2Client.send(startCommand);
      console.log(`EC2 instance ${instanceId} start initiated`);
    } else if (currentState === "pending") {
      // 起動中の場合は起動完了を待ってから再起動
      console.log(
        `EC2 instance ${instanceId} is pending, waiting for start completion...`,
      );
      await waitForInstanceRunning(instanceId);
      console.log(
        `Starting force restart for EC2 instance ${instanceId} after start completion`,
      );
      await forceRestartInstance(instanceId);
    } else {
      console.log(
        `EC2 instance ${instanceId} is in state ${currentState}, cannot restart`,
      );
    }
  } catch (error) {
    console.error(`Error restarting EC2 instance ${instanceId}:`, error);
    throw error;
  }
}

/**
 * S3バケットのパブリックアクセスブロック設定を有効化
 */
async function enableS3PublicAccessBlock(resourceMappingTableName: string) {
  try {
    // S3バケット情報を取得
    const s3BucketInfo = await getResourceInfo(
      resourceMappingTableName,
      "S3_BUCKET",
    );

    if (!s3BucketInfo || !s3BucketInfo.ResourceId) {
      console.warn("S3 Bucket information not found in resource mapping table");

      // 環境変数からのフォールバック
      const bucketName = process.env.MEMO_APP_BUCKET_NAME;
      if (!bucketName) {
        console.warn("MEMO_APP_BUCKET_NAME environment variable is not set");
        return;
      }

      await enablePublicAccessBlock(bucketName);
    } else {
      await enablePublicAccessBlock(s3BucketInfo.ResourceId);
    }
  } catch (error) {
    console.error("Error enabling S3 public access block:", error);
    throw error;
  }
}

/**
 * S3バケットのパブリックアクセスブロックを有効化する
 */
async function enablePublicAccessBlock(bucketName: string) {
  try {
    // 現在の設定を取得
    const getCommand = new GetPublicAccessBlockCommand({
      Bucket: bucketName,
    });
    const currentConfig = await s3Client.send(getCommand);

    console.log(
      `Current S3 public access block config for ${bucketName}:`,
      currentConfig,
    );

    // パブリックアクセスブロックを有効化
    const putCommand = new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    await s3Client.send(putCommand);

    console.log(`S3 public access block enabled for bucket: ${bucketName}`);
  } catch (error) {
    console.error(
      `Error configuring public access block for bucket ${bucketName}:`,
      error,
    );
    throw error;
  }
}

/**
 * CloudTrailを有効化
 */
async function enableCloudTrail(resourceMappingTableName: string) {
  try {
    // CloudTrail情報を取得
    const cloudTrailInfo = await getResourceInfo(
      resourceMappingTableName,
      "CLOUDTRAIL",
    );

    if (!cloudTrailInfo || !cloudTrailInfo.ResourceId) {
      console.warn(
        "CloudTrail information not found in resource mapping table",
      );

      // 環境変数からのフォールバック
      const trailName = process.env.MEMO_APP_CLOUDTRAIL_NAME;
      if (!trailName) {
        console.warn(
          "MEMO_APP_CLOUDTRAIL_NAME environment variable is not set",
        );
        return;
      }

      await enableTrailLogging(trailName);
    } else {
      await enableTrailLogging(cloudTrailInfo.ResourceId);
    }
  } catch (error) {
    console.error("Error enabling CloudTrail:", error);
    throw error;
  }
}

/**
 * CloudTrailのログ記録を有効化する
 */
async function enableTrailLogging(trailName: string) {
  try {
    // IsengardのCloudTrailは変更しない
    if (trailName === "IsengardTrail-DO-NOT-DELETE") {
      console.log(`[SIMULATION] Skipping Isengard CloudTrail: ${trailName}`);
      return;
    }

    // 現在の設定を取得
    const describeCommand = new DescribeTrailsCommand({
      trailNameList: [trailName],
    });
    const trail = await cloudtrailClient.send(describeCommand);

    if (!trail.trailList?.[0]) {
      throw new Error(`CloudTrail ${trailName} not found`);
    }

    // CloudTrailのステータスを取得
    const statusCommand = new GetTrailStatusCommand({
      Name: trailName,
    });
    const status = await cloudtrailClient.send(statusCommand);

    console.log(`Current CloudTrail status for ${trailName}:`, status);

    // CloudTrailが無効な場合は有効化
    if (!status.IsLogging) {
      const startLoggingCommand = new StartLoggingCommand({
        Name: trailName,
      });
      await cloudtrailClient.send(startLoggingCommand);
      console.log(`CloudTrail logging enabled for: ${trailName}`);
    } else {
      console.log(`CloudTrail logging already enabled for: ${trailName}`);
    }

    // CloudTrailの設定を更新（マルチリージョンとグローバルサービスのイベントを有効化）
    const updateCommand = new UpdateTrailCommand({
      Name: trailName,
      IsMultiRegionTrail: true,
      IncludeGlobalServiceEvents: true,
    });
    await cloudtrailClient.send(updateCommand);

    console.log(`CloudTrail configuration updated for: ${trailName}`);
  } catch (error) {
    console.error(`Error configuring CloudTrail ${trailName}:`, error);
    throw error;
  }
}

/**
 * IAMロールを初期状態に戻す
 */
async function resetIAMRole(resourceMappingTableName: string) {
  try {
    // IAMロール情報を取得
    const safeRoleInfo = await getResourceInfo(
      resourceMappingTableName,
      "EC2_SAFE_ROLE",
    );

    if (!safeRoleInfo || !safeRoleInfo.ResourceId) {
      console.warn(
        "EC2 Safe Role information not found in resource mapping table",
      );

      // 環境変数からのフォールバック
      const roleName = process.env.MEMO_APP_EC2_ROLE_NAME;
      if (!roleName) {
        console.warn("MEMO_APP_EC2_ROLE_NAME environment variable is not set");
        return;
      }

      await resetRole(roleName);
    } else {
      await resetRole(safeRoleInfo.ResourceId);
    }
  } catch (error) {
    console.error("Error resetting IAM role:", error);
    throw error;
  }
}

/**
 * IAMロールをリセットする
 * - EC2インスタンスのインスタンスプロファイルをSafeRoleに付け替える
 */
async function resetRole(roleName: string) {
  try {
    console.log(`Starting EC2 role reset process for role: ${roleName}`);

    // ResourceHelperを初期化
    const resourceHelper = new ResourceHelper();

    // SafeRoleのリソースIDを取得
    const safeRoleInfo = await resourceHelper.getResourceInfo("EC2_SAFE_ROLE");
    if (!safeRoleInfo || !safeRoleInfo.ResourceArn) {
      throw new Error("Safe role information not found");
    }
    const safeRoleName = safeRoleInfo.ResourceId;
    console.log(`Retrieved safe role: ${safeRoleName}`);

    // EC2インスタンスのIDを取得
    const instance1Info =
      await resourceHelper.getResourceInfo("EC2_INSTANCE_1");
    const instance2Info =
      await resourceHelper.getResourceInfo("EC2_INSTANCE_2");
    const instances = [instance1Info.ResourceId, instance2Info.ResourceId];

    if (
      !instance1Info ||
      !instance1Info.ResourceId ||
      !instance2Info ||
      !instance2Info.ResourceId
    ) {
      throw new Error("EC2 instance information not found");
    }

    const response = await ec2Client.send(
      new DescribeIamInstanceProfileAssociationsCommand({
        Filters: [
          {
            Name: "instance-id",
            Values: instances,
          },
        ],
      }),
    );

    if (!response.IamInstanceProfileAssociations) {
      throw new Error("No instance profiles.");
    }

    for (const association of response.IamInstanceProfileAssociations) {
      const param: ReplaceIamInstanceProfileAssociationCommandInput = {
        IamInstanceProfile: {
          Arn: safeRoleInfo.ResourceArn,
        },
        AssociationId: association.AssociationId,
      };

      // Instance Profile を replace する
      await ec2Client.send(
        new ReplaceIamInstanceProfileAssociationCommand(param),
      );
    }

    console.log("EC2 role reset completed successfully");
  } catch (error: any) {
    console.error(`Error resetting EC2 role: ${error.message}`);
    // エラーが発生しても処理を続行
    console.log("Continuing with role reset simulation");
  }
}

/**
 * リソース情報を取得する関数
 */
async function getResourceInfo(tableName: string, resourceType: string) {
  try {
    const params = {
      TableName: tableName,
      Key: {
        ResourceType: resourceType,
      },
    };

    const result = await dynamoDB.send(new GetCommand(params));
    return result.Item;
  } catch (error) {
    console.error(`Error getting resource info for ${resourceType}:`, error);
    return null;
  }
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

  await dynamoDB.send(new UpdateCommand(params));
}
/**
 * ゲームの状態を取得する関数
 */
async function getGameState(tableName: string): Promise<string> {
  try {
    const result = await dynamoDB.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          GameId: "default",
        },
      }),
    );

    return result.Item?.State || "Unknown";
  } catch (error) {
    console.error("Error getting game state:", error);
    throw error;
  }
}

/**
 * EC2インスタンスを強制再起動する（停止→起動）
 */
async function forceRestartInstance(instanceId: string): Promise<void> {
  try {
    console.log(`Stopping EC2 instance ${instanceId} for restart`);

    // インスタンスを停止
    const stopCommand = new StopInstancesCommand({
      InstanceIds: [instanceId],
    });
    await ec2Client.send(stopCommand);
    console.log(`Stop command sent for EC2 instance ${instanceId}`);

    // 停止完了を待機
    await waitForInstanceStopped(instanceId);
    console.log(`EC2 instance ${instanceId} stopped successfully`);

    // インスタンスを起動
    console.log(`Starting EC2 instance ${instanceId} after stop`);
    const startCommand = new StartInstancesCommand({
      InstanceIds: [instanceId],
    });
    await ec2Client.send(startCommand);
    console.log(`Start command sent for EC2 instance ${instanceId}`);
  } catch (error) {
    console.error(`Error force restarting EC2 instance ${instanceId}:`, error);
    throw error;
  }
}

/**
 * EC2インスタンスが停止状態になるまで待機
 */
async function waitForInstanceStopped(instanceId: string): Promise<void> {
  const maxWaitTime = 300; // 最大5分待機
  const checkInterval = 10; // 10秒間隔でチェック
  let elapsedTime = 0;

  console.log(`Waiting for EC2 instance ${instanceId} to stop...`);

  while (elapsedTime < maxWaitTime) {
    try {
      const describeCommand = new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      });
      const result = await ec2Client.send(describeCommand);

      const instance = result.Reservations?.[0]?.Instances?.[0];
      const currentState = instance?.State?.Name;

      console.log(
        `EC2 instance ${instanceId} current state: ${currentState} (waited ${elapsedTime}s)`,
      );

      if (currentState === "stopped") {
        console.log(`EC2 instance ${instanceId} is now stopped`);
        return;
      }

      if (currentState === "terminated" || currentState === "shutting-down") {
        throw new Error(
          `EC2 instance ${instanceId} is ${currentState}, cannot restart`,
        );
      }

      // 待機
      await new Promise((resolve) => setTimeout(resolve, checkInterval * 1000));
      elapsedTime += checkInterval;
    } catch (error) {
      console.error(`Error checking EC2 instance ${instanceId} state:`, error);
      throw error;
    }
  }

  throw new Error(
    `Timeout waiting for EC2 instance ${instanceId} to stop after ${maxWaitTime} seconds`,
  );
}

/**
 * EC2インスタンスが実行状態になるまで待機
 */
async function waitForInstanceRunning(instanceId: string): Promise<void> {
  const maxWaitTime = 300; // 最大5分待機
  const checkInterval = 10; // 10秒間隔でチェック
  let elapsedTime = 0;

  console.log(`Waiting for EC2 instance ${instanceId} to start...`);

  while (elapsedTime < maxWaitTime) {
    try {
      const describeCommand = new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      });
      const result = await ec2Client.send(describeCommand);

      const instance = result.Reservations?.[0]?.Instances?.[0];
      const currentState = instance?.State?.Name;

      console.log(
        `EC2 instance ${instanceId} current state: ${currentState} (waited ${elapsedTime}s)`,
      );

      if (currentState === "running") {
        console.log(`EC2 instance ${instanceId} is now running`);
        return;
      }

      if (currentState === "terminated" || currentState === "shutting-down") {
        throw new Error(
          `EC2 instance ${instanceId} is ${currentState}, cannot start`,
        );
      }

      // 待機
      await new Promise((resolve) => setTimeout(resolve, checkInterval * 1000));
      elapsedTime += checkInterval;
    } catch (error) {
      console.error(`Error checking EC2 instance ${instanceId} state:`, error);
      throw error;
    }
  }

  throw new Error(
    `Timeout waiting for EC2 instance ${instanceId} to start after ${maxWaitTime} seconds`,
  );
}

/**
 * 実行中のStep Functionsを停止する
 */
async function stopRunningStepFunctions() {
  try {
    const stateMachineArn = process.env.OBSERVATION_STATE_MACHINE_ARN;
    
    if (!stateMachineArn) {
      console.warn("OBSERVATION_STATE_MACHINE_ARN environment variable is not set");
      return;
    }

    console.log(`Checking for running executions on state machine: ${stateMachineArn}`);

    // 実行中のStep Function実行を取得
    const listCommand = new ListExecutionsCommand({
      stateMachineArn: stateMachineArn,
      statusFilter: ExecutionStatus.RUNNING,
      maxResults: 100
    });

    const listResult = await sfnClient.send(listCommand);
    
    if (!listResult.executions || listResult.executions.length === 0) {
      console.log("No running Step Function executions found");
      return;
    }

    console.log(`Found ${listResult.executions.length} running executions, stopping them...`);

    // 実行中のすべてのStep Functionを停止
    const stopPromises = listResult.executions.map(async (execution) => {
      if (execution.executionArn) {
        try {
          console.log(`Stopping execution: ${execution.executionArn}`);
          const stopCommand = new StopExecutionCommand({
            executionArn: execution.executionArn,
            error: "ResetInitiated",
            cause: "Reset process initiated - stopping existing monitoring"
          });
          
          await sfnClient.send(stopCommand);
          console.log(`Successfully stopped execution: ${execution.executionArn}`);
        } catch (error) {
          console.error(`Error stopping execution ${execution.executionArn}:`, error);
          // 個別の停止エラーは処理を継続
        }
      }
    });

    // すべての停止処理を並行実行
    await Promise.all(stopPromises);
    console.log("All running Step Function executions have been stopped");

  } catch (error) {
    console.error("Error stopping Step Functions:", error);
    // Step Function停止エラーでもリセット処理は継続
    console.log("Continuing reset process despite Step Function stop error");
  }
}

/**
 * StepFunctionを起動して監視を開始する
 */
async function startObservationStateMachine() {
  try {
    const stateMachineArn = process.env.OBSERVATION_STATE_MACHINE_ARN;
    
    if (!stateMachineArn) {
      console.warn("OBSERVATION_STATE_MACHINE_ARN environment variable is not set");
      return;
    }

    // StepFunctionの実行を開始
    const executionName = `reset-observation-${Date.now()}`;
    const input = {
      dynamodb: {
        OldImage: {
          GameId: {
            S: "default"
          }
        }
      }
    };

    const command = new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      name: executionName,
      input: JSON.stringify(input)
    });

    const result = await sfnClient.send(command);
    console.log(`Observation StepFunction started successfully:`, {
      executionArn: result.executionArn,
      executionName: executionName
    });

  } catch (error) {
    console.error("Error starting observation StepFunction:", error);
    // エラーが発生してもリセット処理は継続
    console.log("Continuing reset process despite StepFunction start error");
  }
}

