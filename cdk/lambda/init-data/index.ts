import {
  DescribeInstancesCommandOutput,
  DescribeSecurityGroupsCommandOutput,
} from "@aws-sdk/client-ec2";
import {
  ListInstanceProfilesCommand,
  ListInstanceProfilesCommandOutput,
} from "@aws-sdk/client-iam";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import { IAMClient } from "@aws-sdk/client-iam";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import {
  CloudTrailClient,
  ListTrailsCommand,
} from "@aws-sdk/client-cloudtrail";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const cfnClient = new CloudFormationClient({});
const ec2Client = new EC2Client({});
const iamClient = new IAMClient({});
const s3Client = new S3Client({});
const cloudTrailClient = new CloudTrailClient({});

/**
 * DynamoDBテーブルに初期データを投入するLambda関数
 * リソース検出機能も含む
 */
const initializeDatabase = async () => {
  try {
    const gameStateTableName =
      process.env.GAME_STATE_TABLE_NAME || "GameStateTable";
    const securityTableName =
      process.env.SECURITY_TABLE_NAME || "SecurityScenarioTable";
    const resilienceTableName =
      process.env.RESILIENCE_TABLE_NAME || "ResilienceScenarioTable";
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";
    const stackName = process.env.STACK_NAME;
    const accountId = process.env.AWS_ACCOUNT_ID;

    // GameStateテーブルに初期データを投入
    await ddb.send(
      new PutCommand({
        TableName: gameStateTableName,
        Item: {
          GameId: "default",
          State: "Ready",
        },
      }),
    );

    // SecurityScenarioテーブルに初期データを投入
    const securityComponents = [
      {
        ComponentName: "ALB SG",
        InitialValue: "secure-config",
        CurrentState: "Green",
        Description: "ALBのセキュリティグループ設定",
      },
      {
        ComponentName: "EC2 SG",
        InitialValue: "secure-config",
        CurrentState: "Green",
        Description: "EC2のセキュリティグループ設定",
      },
      {
        ComponentName: "EC2 Role",
        InitialValue: "SafeRole",
        CurrentState: "Green",
        Description: "EC2に設定されているIAMロール",
      },
      {
        ComponentName: "S3",
        InitialValue: "block-public-access",
        CurrentState: "Green",
        Description: "S3バケットのパブリックアクセス設定",
      },
      {
        ComponentName: "RDS SG",
        InitialValue: "secure-config",
        CurrentState: "Green",
        Description: "RDSのセキュリティグループ設定",
      },
      {
        ComponentName: "CloudTrail",
        InitialValue: "enabled",
        CurrentState: "Green",
        Description: "CloudTrailの有効化状態",
      },
    ];

    for (const component of securityComponents) {
      await ddb.send(
        new PutCommand({
          TableName: securityTableName,
          Item: component,
        }),
      );
    }

    // ResilienceScenarioテーブルに初期データを投入
    const resilienceComponents = [
      {
        ComponentName: "EC2",
        InitialValue: "running",
        CurrentState: "Green",
        Description: "EC2インスタンスの状態",
      },
      {
        ComponentName: "ALB SG",
        InitialValue: "http-allowed",
        CurrentState: "Green",
        Description: "ALBのセキュリティグループのHTTP通信許可設定",
      },
      {
        ComponentName: "EC2 SG",
        InitialValue: "alb-to-ec2-allowed",
        CurrentState: "Green",
        Description: "EC2のセキュリティグループのALBからの通信許可設定",
      },
      {
        ComponentName: "EC2 Process",
        InitialValue: "running",
        CurrentState: "Green",
        Description: "EC2上のアプリケーションプロセスの状態",
      },
    ];

    for (const component of resilienceComponents) {
      await ddb.send(
        new PutCommand({
          TableName: resilienceTableName,
          Item: component,
        }),
      );
    }

    // スタック情報からリソースを検出して ResourceMappingテーブルに格納
    if (stackName) {
      try {
        // スタック情報を取得
        const stackResponse = await cfnClient.send(
          new DescribeStacksCommand({
            StackName: stackName,
          }),
        );

        // EC2インスタンスを検出
        const ec2Response: DescribeInstancesCommandOutput =
          await ec2Client.send(
            new DescribeInstancesCommand({
              Filters: [
                {
                  Name: "tag:aws:cloudformation:stack-name",
                  Values: [stackName],
                },
              ],
            }),
          );

        // セキュリティグループを検出
        const sgResponse: DescribeSecurityGroupsCommandOutput =
          await ec2Client.send(
            new DescribeSecurityGroupsCommand({
              Filters: [
                {
                  Name: "tag:aws:cloudformation:stack-name",
                  Values: [stackName],
                },
              ],
            }),
          );

        // Instance Profile を検出
        const instanceProfilesResponse: ListInstanceProfilesCommandOutput =
          await iamClient.send(new ListInstanceProfilesCommand({}));

        // S3バケットを検出
        const bucketsResponse = await s3Client.send(new ListBucketsCommand({}));

        // CloudTrailを検出
        const trailsResponse = await cloudTrailClient.send(
          new ListTrailsCommand({}),
        );

        // 検出したリソースをマッピングテーブルに格納
        const resourceMappings = [];

        // EC2プロセスの情報を追加
        resourceMappings.push({
          ResourceType: "EC2_PROCESS",
          ResourceId: "demoapp.service",
          ResourceName: "Demo Application Service",
          AdditionalInfo: JSON.stringify({
            description:
              "EC2インスタンス上で動作するデモアプリケーションサービス",
            command: "systemctl status demoapp.service",
          }),
        });

        // EC2インスタンスの処理
        if (ec2Response.Reservations) {
          let numOfInstances = 0;
          for (const reservation of ec2Response.Reservations) {
            for (const instance of reservation.Instances!) {
              // Stackデプロイ直後は、終了前のインスタンスも含まれてしまうため、
              // 起動中だけでなく、Stack が更新された後にプロビジョニングされたインスタンスのみを対象とする
              if (
                instance.State!.Name === "running" &&
                stackResponse.Stacks![0].LastUpdatedTime! < instance.LaunchTime!
              ) {
                numOfInstances++;
                const nameTag = instance.Tags?.find(
                  (tag) => tag.Key === "Name",
                );
                resourceMappings.push({
                  ResourceType: `EC2_INSTANCE_${numOfInstances}`,
                  ResourceId: instance.InstanceId,
                  ResourceName: nameTag ? nameTag.Value : instance.InstanceId,
                  ResourceArn: `arn:aws:ec2:${process.env.AWS_REGION}:${accountId}:instance/${instance.InstanceId}`,
                  AdditionalInfo: JSON.stringify({
                    state: instance.State!.Name,
                    privateIp: instance.PrivateIpAddress,
                    publicIp: instance.PublicIpAddress,
                    securityGroups: instance.SecurityGroups,
                  }),
                });
              }
            }
          }
        }

        // セキュリティグループの処理
        if (sgResponse.SecurityGroups) {
          for (const sg of sgResponse.SecurityGroups) {
            const nameTag = sg.Tags?.find((tag) => tag.Key === "Name");
            let sgType = undefined;
            if (sg.GroupName!.includes("Alb")) {
              sgType = "ALB_SG";
            } else if (sg.GroupName!.includes("AuroraClusterSecurityGroup")) {
              sgType = "RDS_SG";
            } else if (sg.GroupName!.includes("Ec2SecurityGroup")) {
              sgType = "EC2_SG";
            }

            if (sgType) {
              resourceMappings.push({
                ResourceType: sgType,
                ResourceId: sg.GroupId,
                ResourceName: nameTag ? nameTag.Value : sg.GroupName,
                ResourceArn: `arn:aws:ec2:${process.env.AWS_REGION}:${accountId}:security-group/${sg.GroupId}`,
                AdditionalInfo: JSON.stringify({
                  description: sg.Description,
                  vpcId: sg.VpcId,
                }),
              });
            }
          }
        }

        // Instance Profile の処理
        // SafeRole が関連づいた Instance Profile と Unsafe Role が関連づいた Intance Profile を登録しておく
        if (instanceProfilesResponse.InstanceProfiles) {
          for (const instanceProfile of instanceProfilesResponse.InstanceProfiles) {
            // Role が関連づいていて、かつ本プロジェクトで作られた Instance Profile であること
            if (
              instanceProfile.Roles &&
              instanceProfile.Roles[0].RoleName!.includes(stackName)
            ) {
              const role = instanceProfile.Roles![0];
              if (role.RoleName!.includes("Safe")) {
                resourceMappings.push({
                  ResourceType: "EC2_SAFE_ROLE",
                  ResourceId: instanceProfile.InstanceProfileId,
                  ResourceName: instanceProfile.InstanceProfileName,
                  ResourceArn: instanceProfile.Arn,
                  AdditionalInfo: JSON.stringify({
                    path: instanceProfile.Path,
                    createDate: instanceProfile.CreateDate!.toISOString(),
                  }),
                });
              } else if (role.RoleName!.includes("Unsafe")) {
                resourceMappings.push({
                  ResourceType: "EC2_UNSAFE_ROLE",
                  ResourceId: instanceProfile.InstanceProfileId,
                  ResourceName: instanceProfile.InstanceProfileName,
                  ResourceArn: instanceProfile.Arn,
                  AdditionalInfo: JSON.stringify({
                    path: instanceProfile.Path,
                    createDate: instanceProfile.CreateDate!.toISOString(),
                  }),
                });
              }
            }
          }
        }

        // S3バケットの処理
        if (bucketsResponse.Buckets) {
          for (const bucket of bucketsResponse.Buckets) {
            if (bucket.Name!.includes(`${stackName.toLowerCase()}-traillogbucket`)) {
              resourceMappings.push({
                ResourceType: "S3_BUCKET",
                ResourceId: bucket.Name,
                ResourceName: bucket.Name,
                ResourceArn: `arn:aws:s3:::${bucket.Name}`,
                AdditionalInfo: JSON.stringify({
                  creationDate: bucket.CreationDate!.toISOString(),
                }),
              });
            }
          }
        }

        // CloudTrailの処理
        if (trailsResponse.Trails) {
          for (const trail of trailsResponse.Trails) {
            if (trail.Name!.includes("InteractiveIncidentLearningSimulatorDoNotDisable")) {
              resourceMappings.push({
                ResourceType: "CLOUDTRAIL",
                ResourceId: trail.TrailARN!.split("/").pop(),
                ResourceName: trail.Name,
                ResourceArn: trail.TrailARN,
                AdditionalInfo: JSON.stringify({
                  homeRegion: trail.HomeRegion,
                }),
              });
            }
          }
        }

        // 検出したリソースをDynamoDBに保存
        for (const mapping of resourceMappings) {
          await ddb.send(
            new PutCommand({
              TableName: resourceMappingTableName,
              Item: mapping,
            }),
          );
        }

        console.log(
          `Discovered and saved ${resourceMappings.length} resources`,
        );
      } catch (discoveryError) {
        console.error("Error during resource discovery:", discoveryError);
        // リソース検出に失敗してもダミーデータを投入する
        await insertDummyResourceMappings(resourceMappingTableName);
      }
    } else {
      // スタック名が指定されていない場合はダミーデータを投入
      await insertDummyResourceMappings(resourceMappingTableName);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Initial data inserted successfully",
      }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error inserting initial data",
        error: (error as Error).message,
      }),
    };
  }
};

/**
 * ダミーのリソースマッピングデータを投入する関数
 */
async function insertDummyResourceMappings(tableName: string) {
  const resourceMappings = [
    {
      ResourceType: "EC2_INSTANCE_1",
      ResourceId: "i-dummy1",
      ResourceName: "MemoAppInstance1",
      AdditionalInfo: JSON.stringify({
        description: "メモアプリケーションが稼働するEC2インスタンス1",
      }),
    },
    {
      ResourceType: "EC2_INSTANCE_2",
      ResourceId: "i-dummy2",
      ResourceName: "MemoAppInstance2",
      AdditionalInfo: JSON.stringify({
        description: "メモアプリケーションが稼働するEC2インスタンス2",
      }),
    },
    {
      ResourceType: "EC2_PROCESS",
      ResourceId: "demoapp.service",
      ResourceName: "Demo Application Service",
      AdditionalInfo: JSON.stringify({
        description: "EC2インスタンス上で動作するデモアプリケーションサービス",
      }),
    },
    {
      ResourceType: "ALB_SG",
      ResourceId: "sg-dummy-alb",
      ResourceName: "MemoAppALBSecurityGroup",
      AdditionalInfo: JSON.stringify({
        description: "ALBのセキュリティグループ",
      }),
    },
    {
      ResourceType: "EC2_SG",
      ResourceId: "sg-dummy-ec2",
      ResourceName: "MemoAppEC2SecurityGroup",
      AdditionalInfo: JSON.stringify({
        description: "EC2インスタンスのセキュリティグループ",
      }),
    },
    {
      ResourceType: "EC2_SAFE_ROLE",
      ResourceId: "role-dummy",
      ResourceName: "MemoAppEC2SageRole",
      ResourceArn: "arn:aws:iam::123456789012:role/MemoAppEC2SafeRole",
      AdditionalInfo: JSON.stringify({
        description: "EC2インスタンスに割り当てられた安全なIAMロール",
      }),
    },
    {
      ResourceType: "EC2_UNSAFE_ROLE",
      ResourceId: "role-dummy",
      ResourceName: "MemoAppEC2UnsafeRole",
      ResourceArn: "arn:aws:iam::123456789012:role/MemoAppEC2UnsafeRole",
      AdditionalInfo: JSON.stringify({
        description: "障害注入時に割り当てられる予定の危険なIAMロール",
      }),
    },
    {
      ResourceType: "S3_BUCKET",
      ResourceId: "memo-app-dummy-bucket",
      ResourceName: "MemoAppBucket",
      AdditionalInfo: JSON.stringify({
        description: "メモアプリケーションで使用するS3バケット",
      }),
    },
    {
      ResourceType: "RDS_SG",
      ResourceId: "sg-dummy-rds",
      ResourceName: "MemoAppRDSSecurityGroup",
      AdditionalInfo: JSON.stringify({
        description: "RDSのセキュリティグループ",
      }),
    },
    {
      ResourceType: "CLOUDTRAIL",
      ResourceId: "memo-app-trail",
      ResourceName: "MemoAppCloudTrail",
      AdditionalInfo: JSON.stringify({
        description: "メモアプリケーション環境のCloudTrail",
      }),
    },
  ];

  for (const mapping of resourceMappings) {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: mapping,
      }),
    );
  }

  console.log("Inserted dummy resource mappings");
}

export const handler = async (event: any) => {
  console.log(`Received event: ${JSON.stringify(event)}`);
  const requestType = event.RequestType;

  if ("ServiceToken" in event.ResourceProperties) {
    delete event.ResourceProperties.ServiceToken;
  }

  if (requestType === "Create") {
    return await initializeDatabase();
  }
  if (requestType === "Update") {
    return await initializeDatabase();
  }
  if (requestType === "Delete") {
    // DDB であればリソースが削除されたタイミングでデータが消えるので、何もしない
    return;
  }
  throw new Error("Invalid request type: " + requestType);
};
