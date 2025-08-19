import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import { IAMClient, ListRolesCommand } from "@aws-sdk/client-iam";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import {
  CloudTrailClient,
  ListTrailsCommand,
} from "@aws-sdk/client-cloudtrail";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// AWS SDKクライアントの初期化
const cloudformationClient = new CloudFormationClient();
const ec2Client = new EC2Client();
const iamClient = new IAMClient();
const s3Client = new S3Client();
const cloudtrailClient = new CloudTrailClient();
const dynamoClient = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

/**
 * リソース検出と情報更新のためのクラス
 */
export class ResourceDiscovery {
  private stackName: string;
  private resourceMappingTableName: string;

  /**
   * コンストラクタ
   * @param stackName CloudFormationスタック名
   * @param resourceMappingTableName リソースマッピングテーブル名
   */
  constructor(
    stackName: string = "InteractiveIncidentLearningSimulatorStack",
    resourceMappingTableName: string = "ResourceMappingTable",
  ) {
    this.stackName = stackName;
    this.resourceMappingTableName = resourceMappingTableName;
  }

  /**
   * CloudFormationスタックの出力値を取得する
   * @returns スタックの出力値のマップ
   */
  async getStackOutputs(): Promise<Map<string, string>> {
    try {
      const response = await cloudformationClient.send(
        new DescribeStacksCommand({
          StackName: this.stackName,
        }),
      );

      if (!response.Stacks || response.Stacks.length === 0) {
        throw new Error(`Stack ${this.stackName} not found`);
      }

      const outputs = response.Stacks[0].Outputs || [];
      const outputMap = new Map<string, string>();

      outputs.forEach((output) => {
        if (output.OutputKey && output.OutputValue) {
          outputMap.set(output.OutputKey, output.OutputValue);
        }
      });

      return outputMap;
    } catch (error) {
      console.error(`Error getting stack outputs: ${error}`);
      throw error;
    }
  }

  /**
   * タグでEC2リソースを検索する
   * @param tagKey タグのキー
   * @param tagValue タグの値
   * @returns リソースIDのリスト
   */
  async findResourcesByTag(
    tagKey: string,
    tagValue: string,
  ): Promise<string[]> {
    try {
      const response = await ec2Client.send(
        new DescribeInstancesCommand({
          Filters: [
            {
              Name: `tag:${tagKey}`,
              Values: [tagValue],
            },
          ],
        }),
      );

      const instanceIds: string[] = [];
      if (response.Reservations) {
        response.Reservations.forEach((reservation) => {
          if (reservation.Instances) {
            reservation.Instances.forEach((instance) => {
              if (instance.InstanceId) {
                instanceIds.push(instance.InstanceId);
              }
            });
          }
        });
      }

      return instanceIds;
    } catch (error) {
      console.error(`Error finding resources by tag: ${error}`);
      throw error;
    }
  }

  /**
   * セキュリティグループを名前で検索する
   * @param namePattern 名前のパターン（部分一致）
   * @returns セキュリティグループIDのリスト
   */
  async findSecurityGroupsByName(namePattern: string): Promise<string[]> {
    try {
      const response = await ec2Client.send(
        new DescribeSecurityGroupsCommand({
          Filters: [
            {
              Name: "group-name",
              Values: [`*${namePattern}*`],
            },
          ],
        }),
      );

      const sgIds: string[] = [];
      if (response.SecurityGroups) {
        response.SecurityGroups.forEach((sg) => {
          if (sg.GroupId) {
            sgIds.push(sg.GroupId);
          }
        });
      }

      return sgIds;
    } catch (error) {
      console.error(`Error finding security groups by name: ${error}`);
      throw error;
    }
  }

  /**
   * IAMロールを名前のパターンで検索する
   * @param namePattern 名前のパターン（部分一致）
   * @returns ロール名のリスト
   */
  async findRolesByName(namePattern: string): Promise<string[]> {
    try {
      const response = await iamClient.send(new ListRolesCommand({}));
      const roleNames: string[] = [];

      if (response.Roles) {
        response.Roles.forEach((role) => {
          if (role.RoleName && role.RoleName.includes(namePattern)) {
            roleNames.push(role.RoleName);
          }
        });
      }

      return roleNames;
    } catch (error) {
      console.error(`Error finding roles by name: ${error}`);
      throw error;
    }
  }

  /**
   * S3バケットを名前のパターンで検索する
   * @param namePattern 名前のパターン（部分一致）
   * @returns バケット名のリスト
   */
  async findBucketsByName(namePattern: string): Promise<string[]> {
    try {
      const response = await s3Client.send(new ListBucketsCommand({}));
      const bucketNames: string[] = [];

      if (response.Buckets) {
        response.Buckets.forEach((bucket) => {
          if (bucket.Name && bucket.Name.includes(namePattern)) {
            bucketNames.push(bucket.Name);
          }
        });
      }

      return bucketNames;
    } catch (error) {
      console.error(`Error finding buckets by name: ${error}`);
      throw error;
    }
  }

  /**
   * CloudTrailを名前のパターンで検索する
   * @param namePattern 名前のパターン（部分一致）
   * @returns トレイル名のリスト
   */
  async findCloudTrailsByName(namePattern: string): Promise<string[]> {
    try {
      const response = await cloudtrailClient.send(new ListTrailsCommand({}));
      const trailNames: string[] = [];

      if (response.Trails) {
        response.Trails.forEach((trail) => {
          if (trail.Name && trail.Name.includes(namePattern)) {
            trailNames.push(trail.Name);
          }
        });
      }

      return trailNames;
    } catch (error) {
      console.error(`Error finding CloudTrails by name: ${error}`);
      throw error;
    }
  }

  /**
   * リソースマッピングテーブルを更新する
   * @param resourceType リソースタイプ
   * @param resourceId リソースID
   * @param resourceArn リソースARN（オプション）
   */
  async updateResourceMapping(
    resourceType: string,
    resourceId: string,
    resourceArn?: string,
  ): Promise<void> {
    try {
      const updateExpression = resourceArn
        ? "SET ResourceId = :id, ResourceArn = :arn"
        : "SET ResourceId = :id";

      const expressionAttributeValues = resourceArn
        ? { ":id": resourceId, ":arn": resourceArn }
        : { ":id": resourceId };

      await dynamoDB.send(
        new UpdateCommand({
          TableName: this.resourceMappingTableName,
          Key: { ResourceType: resourceType },
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: expressionAttributeValues,
        }),
      );

      console.log(
        `Updated resource mapping for ${resourceType}: ${resourceId}`,
      );
    } catch (error) {
      console.error(`Error updating resource mapping: ${error}`);
      throw error;
    }
  }

  /**
   * 全てのリソース情報を自動検出して更新する
   */
  async discoverAndUpdateAllResources(): Promise<void> {
    try {
      // CloudFormationスタックの出力値を取得
      const outputs = await this.getStackOutputs();

      // ALBのセキュリティグループを更新
      if (outputs.has("DemoAppAuroraAuroraSecurityGroupIdAF1CBDF7")) {
        const albSgId = outputs.get(
          "DemoAppAuroraAuroraSecurityGroupIdAF1CBDF7",
        );
        await this.updateResourceMapping("RDS_SG", albSgId!);
      } else {
        // 出力値がない場合は名前で検索
        const rdsSgs = await this.findSecurityGroupsByName("Aurora");
        if (rdsSgs.length > 0) {
          await this.updateResourceMapping("RDS_SG", rdsSgs[0]);
        }
      }

      // EC2のセキュリティグループを検索して更新
      const ec2Sgs = await this.findSecurityGroupsByName("WebappBase");
      if (ec2Sgs.length > 0) {
        await this.updateResourceMapping("EC2_SG", ec2Sgs[0]);
      }

      // ALBのセキュリティグループを検索して更新
      const albSgs = await this.findSecurityGroupsByName("ALB");
      if (albSgs.length > 0) {
        await this.updateResourceMapping("ALB_SG", albSgs[0]);
      }

      // EC2インスタンスを検索して更新
      const ec2Instances = await this.findResourcesByTag(
        "aws:cloudformation:stack-name",
        this.stackName,
      );
      if (ec2Instances.length > 0) {
        await this.updateResourceMapping("EC2_INSTANCE", ec2Instances[0]);
      }

      // IAMロールを検索して更新
      const roles = await this.findRolesByName("WebappBase");
      if (roles.length > 0) {
        const roleName = roles[0];
        const roleArn = `arn:aws:iam::${process.env.AWS_ACCOUNT_ID || "293760143191"}:role/${roleName}`;
        await this.updateResourceMapping("EC2_ROLE", roleName, roleArn);
      }

      // S3バケットを検索して更新
      const buckets = await this.findBucketsByName("InteractiveIncidentLearningSimulatorStack");
      if (buckets.length > 0) {
        await this.updateResourceMapping("S3_BUCKET", buckets[0]);
      }

      // CloudTrailを検索して更新
      const trails = await this.findCloudTrailsByName("");
      if (trails.length > 0) {
        // IsengardTrailを優先
        const isengardTrail = trails.find((t) => t.includes("Isengard"));
        if (isengardTrail) {
          await this.updateResourceMapping("CLOUDTRAIL", isengardTrail);
        } else if (trails.length > 0) {
          await this.updateResourceMapping("CLOUDTRAIL", trails[0]);
        }
      }

      console.log("All resources discovered and updated successfully");
    } catch (error) {
      console.error(`Error discovering and updating resources: ${error}`);
      throw error;
    }
  }
}

/**
 * リソース検出と更新を実行するハンドラー関数
 */
export const handler = async (event: any): Promise<any> => {
  try {
    const stackName = process.env.STACK_NAME || "InteractiveIncidentLearningSimulatorStack";
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const discovery = new ResourceDiscovery(
      stackName,
      resourceMappingTableName,
    );
    await discovery.discoverAndUpdateAllResources();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Resources discovered and updated successfully",
      }),
    };
  } catch (error: any) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error discovering resources",
        error: error.message,
      }),
    };
  }
};
