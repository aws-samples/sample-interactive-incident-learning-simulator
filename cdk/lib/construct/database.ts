import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as path from "path";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { NagSuppressions } from "cdk-nag";
import { Stack } from "aws-cdk-lib";

// テーブルのアイテム型定義
export interface GameStateItem {
  GameId: string;
  State: "Ready" | "Ongoing" | "Resetting";
}

export interface ScenarioItem {
  ComponentName: string;
  InitialValue: string;
  CurrentState: "Green" | "Red";
  Description?: string;
}

export interface ResourceMappingItem {
  ResourceType: string;
  ResourceId: string;
  ResourceName?: string;
  ResourceArn?: string;
  AdditionalInfo?: string;
}

export interface DatabaseProps extends cdk.StackProps {
  //親スタックから受け取る変数型を記載
}

export class Database extends Construct {
  public readonly gameStateTable: ddb.Table;
  public readonly securityScenarioTable: ddb.Table;
  public readonly resilienceScenarioTable: ddb.Table;
  public readonly resourceMappingTable: ddb.Table;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    this.gameStateTable = new ddb.Table(this, "GameStateTable", {
      tableName: "GameStateTable",
      partitionKey: {
        name: "GameId",
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: ddb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    this.securityScenarioTable = new ddb.Table(this, "SecurityScenarioTable", {
      tableName: "SecurityScenarioTable",
      partitionKey: {
        name: "ComponentName",
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: ddb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    this.resilienceScenarioTable = new ddb.Table(
      this,
      "ResilienceScenarioTable",
      {
        tableName: "ResilienceScenarioTable",
        partitionKey: {
          name: "ComponentName",
          type: ddb.AttributeType.STRING,
        },
        billingMode: ddb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        stream: ddb.StreamViewType.NEW_AND_OLD_IMAGES,
      },
    );

    // ResourceMappingテーブルの追加
    this.resourceMappingTable = new ddb.Table(this, "ResourceMappingTable", {
      tableName: "ResourceMappingTable",
      partitionKey: {
        name: "ResourceType",
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // テーブルの初期データを設定するためのカスタムリソース
    this.setupInitialData();
  }

  private setupInitialData() {
    // 初期データ投入用のLambda関数
    const initDataFunction = new NodejsFunction(this, "InitDataFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../../lambda/init-data/index.ts"),
      timeout: cdk.Duration.seconds(60), // タイムアウトを60秒に設定
      memorySize: 256, // メモリサイズも増やして処理速度を向上
      environment: {
        SECURITY_TABLE_NAME: this.securityScenarioTable.tableName,
        RESILIENCE_TABLE_NAME: this.resilienceScenarioTable.tableName,
        GAME_STATE_TABLE_NAME: this.gameStateTable.tableName,
        RESOURCE_MAPPING_TABLE_NAME: this.resourceMappingTable.tableName,
        STACK_NAME: cdk.Stack.of(this).stackName,
        AWS_ACCOUNT_ID: cdk.Stack.of(this).account,
      },
    });

    // AWS リソース検出のための権限を追加
    initDataFunction.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "cloudformation:DescribeStacks",
          "ec2:DescribeInstances",
          "ec2:DescribeSecurityGroups",
          "iam:ListRoles",
          "iam:ListInstanceProfiles",
          "s3:ListBuckets",
          "s3:ListAllMyBuckets",
          "cloudtrail:ListTrails",
        ],
        resources: ["*"],
      }),
    );

    // テーブルへの書き込み権限を付与
    this.securityScenarioTable.grantWriteData(initDataFunction);
    this.resilienceScenarioTable.grantWriteData(initDataFunction);
    this.gameStateTable.grantWriteData(initDataFunction);
    this.resourceMappingTable.grantWriteData(initDataFunction);

    // カスタムリソースプロバイダー
    const provider = new cr.Provider(this, "InitDataProvider", {
      onEventHandler: initDataFunction,
      // isCompleteHandlerを指定しない場合はtotalTimeoutを設定できない
    });

    // カスタムリソースの作成
    new cdk.CustomResource(this, "InitDatabaseData", {
      serviceToken: provider.serviceToken,
      properties: {
        // 再デプロイ時に必ず実行されるようにタイムスタンプを含める
        Timestamp: new Date().toISOString(),
      },
    });

    /**
     * CDK-NAG Suppressions
     */
    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${initDataFunction.node.path}/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason: "Lambda managed policy makes it simple",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${initDataFunction.node.path}/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Lambda managed policy makes it simple. And cloudwatch logs requires * resources",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${provider.node.path}/framework-onEvent/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason: "This is a default policy for the provider framework.",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${provider.node.path}/framework-onEvent/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "This is a default policy for the provider framework.",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${provider.node.path}/framework-onEvent/Resource`,
      [
        {
          id: "AwsSolutions-L1",
          reason: "This is a default configuration for the provider framework.",
        },
      ],
    );
  }
}
