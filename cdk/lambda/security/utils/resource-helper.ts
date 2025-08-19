import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

// AWS SDKクライアントの初期化
const cloudformationClient = new CloudFormationClient();
const dynamoClient = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

/**
 * リソース情報を取得するヘルパークラス
 */
export class ResourceHelper {
  private resourceMappingTableName: string;
  private stackName: string;

  /**
   * コンストラクタ
   * @param resourceMappingTableName リソースマッピングテーブル名
   * @param stackName CloudFormationスタック名
   */
  constructor(
    resourceMappingTableName: string = "ResourceMappingTable",
    stackName: string = "InteractiveIncidentLearningSimulatorStack",
  ) {
    this.resourceMappingTableName = resourceMappingTableName;
    this.stackName = stackName;
  }

  /**
   * リソース情報をDynamoDBから取得する
   * @param resourceType リソースタイプ
   * @returns リソース情報
   */
  async getResourceInfo(resourceType: string): Promise<any> {
    try {
      const params = {
        TableName: this.resourceMappingTableName,
        Key: {
          ResourceType: resourceType,
        },
      };

      const result = await dynamoDB.send(new GetCommand(params));
      return result.Item;
    } catch (error) {
      console.error(
        `Error getting resource info for ${resourceType}: ${error}`,
      );
      throw error;
    }
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
   * リソースIDをDynamoDBから取得し、存在しない場合はCloudFormationから取得する
   * @param resourceType リソースタイプ
   * @param outputKey CloudFormation出力のキー
   * @returns リソースID
   */
  async getResourceId(
    resourceType: string,
    outputKey?: string,
  ): Promise<string> {
    try {
      // まずDynamoDBからリソース情報を取得
      const resourceInfo = await this.getResourceInfo(resourceType);

      // リソース情報が存在し、ResourceIdが設定されている場合はそれを返す
      if (resourceInfo && resourceInfo.ResourceId) {
        return resourceInfo.ResourceId;
      }

      // DynamoDBに情報がない場合はCloudFormationから取得
      if (outputKey) {
        const outputs = await this.getStackOutputs();
        if (outputs.has(outputKey)) {
          return outputs.get(outputKey)!;
        }
      }

      throw new Error(`Resource ID not found for ${resourceType}`);
    } catch (error) {
      console.error(`Error getting resource ID for ${resourceType}: ${error}`);
      throw error;
    }
  }

  /**
   * コンポーネント名からリソースタイプへのマッピング関数
   */
  mapComponentToResourceType(componentName: string): string {
    switch (componentName) {
      case "ALB SG":
        return "ALB_SG";
      case "EC2 SG":
        return "EC2_SG";
      case "EC2 Role":
        // EC2_ROLEではなく、EC2_SAFE_ROLEとEC2_UNSAFE_ROLEを使い分ける
        return "EC2_SAFE_ROLE"; // 初期状態では安全なロールを参照
      case "S3":
        return "S3_BUCKET";
      case "RDS SG":
        return "RDS_SG";
      case "CloudTrail":
        return "CLOUDTRAIL";
      default:
        return componentName;
    }
  }

  /**
   * リソースタイプからCloudFormation出力キーへのマッピング関数
   */
  mapResourceTypeToOutputKey(resourceType: string): string | undefined {
    switch (resourceType) {
      case "ALB_SG":
        return "DemoAppALBSecurityGroupId";
      case "EC2_SG":
        return "DemoAppEC2SecurityGroupId";
      case "RDS_SG":
        return "DemoAppAuroraAuroraSecurityGroupIdAF1CBDF7";
      case "S3_BUCKET":
        return "DemoAppS3BucketName";
      default:
        return undefined;
    }
  }
}
