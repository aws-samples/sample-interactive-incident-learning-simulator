import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as path from "path";
import { NagSuppressions } from "cdk-nag";

/**
 * Incident 発生を画面側に伝えるため、Lambda 関数と AppSync リソースを作成する
 * AppSync へは Lambda 関数から Mutation を介して Incident 情報を連携する
 * クライアントでは AppSync の Subcription を Subscribe して情報を受け取る
 */

export class DetectIncidents extends Construct {
  public readonly incidentFunction: lambda.Function;
  public readonly api: appsync.GraphqlApi;

  constructor(scope: Construct, id: string, topicList: sns.Topic[]) {
    super(scope, id);

    const appSyncLogsRole = new iam.Role(this, "AppSyncLogsRole", {
      assumedBy: new iam.ServicePrincipal("appsync.amazonaws.com"),
      inlinePolicies: {
        CloudWatchLogsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
              ],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    // AppSyncのCloudWatchログ出力のためのワイルドカード権限を抑制
    NagSuppressions.addResourceSuppressions(appSyncLogsRole, [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Wildcard permissions are required for CloudWatch logs creation and writing across multiple log groups",
      },
    ]);

    // スキーマファイルのパスを指定
    const schemaPath = path.join(__dirname, "../../schema/schema.graphql");

    // AppSync API の作成
    this.api = new appsync.GraphqlApi(this, "IncidentApi", {
      name: "incident-detection-api",
      definition: appsync.Definition.fromFile(schemaPath),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            name: "incident-api-key",
            description: "API Key for Incident Detection API",
            expires: cdk.Expiration.after(cdk.Duration.days(365)), // 1年間有効
          },
        },
      },
      xrayEnabled: true, // X-Ray トレースを有効化
      // ログ設定を追加
      logConfig: {
        role: appSyncLogsRole,
        fieldLogLevel: appsync.FieldLogLevel.ALL, // 全てのフィールドレベルログを記録
        excludeVerboseContent: false, // 詳細なコンテンツも含める
      },
    });

    // API Key と URL の取得
    const apiKey = this.api.apiKey || "";
    const apiUrl = this.api.graphqlUrl;

    // Create the Lambda function for incident detection
    this.incidentFunction = new nodejs.NodejsFunction(
      this,
      "IncidentFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.handler",
        entry: path.join(__dirname, "../../lambda/pass-incident/index.ts"),
        bundling: {
          bundleAwsSDK: true,
        },
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        description:
          "Lambda function to handle incident detection and processing",
        environment: {
          // Add AppSync API Key and URL to Lambda environment variables
          APPSYNC_API_KEY: apiKey,
          APPSYNC_API_URL: apiUrl,
          NODE_OPTIONS: "--enable-source-maps",
        },
      },
    );

    // Lambda関数のServiceRoleに対するマネージドポリシー使用を抑制
    NagSuppressions.addResourceSuppressions(this.incidentFunction.role!, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "AWSLambdaBasicExecutionRole is a standard AWS managed policy for Lambda CloudWatch logging functionality",
      },
    ]);

    // Grant necessary permissions to the Lambda function
    this.incidentFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["*"],
      }),
    );

    // AppSync に対して Mutation を実行する権限を付与
    this.incidentFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["appsync:GraphQL"],
        resources: [`${this.api.arn}/*`],
      }),
    );

    // Lambda関数のServiceRoleのDefaultPolicyに対するワイルドカード権限を抑制
    NagSuppressions.addResourceSuppressions(
      this.incidentFunction.role!.node.tryFindChild(
        "DefaultPolicy",
      ) as iam.Policy,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Wildcard permissions are required for CloudWatch logs creation and AppSync GraphQL operations",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `/${cdk.Stack.of(this).stackName}/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Managed policy is required for CloudWatch logs creation and AppSync GraphQL operations",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `/${cdk.Stack.of(this).stackName}/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Wildcard permissions are required for CloudWatch logs creation and AppSync GraphQL operations",
        },
      ],
    );

    // None タイプのデータソースを作成
    const noneDataSource = this.api.addNoneDataSource("NoneDataSource", {
      name: "NoneDataSource",
      description: "None data source for direct resolvers",
    });

    // Mutation リゾルバーを None データソースに設定
    noneDataSource.createResolver("UpdatedCompnentResolver", {
      typeName: "Mutation",
      fieldName: "updatedCompnent",
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
            "version": "2018-05-29",
            "payload": {
            "component": "\${context.arguments.input.component}",
            "state": "\${context.arguments.input.state}"
            }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        $util.toJson($context.result)
      `),
    });

    // Mutation リゾルバーを None データソースに設定
    noneDataSource.createResolver("UpdatedGameStateResolver", {
      typeName: "Mutation",
      fieldName: "updatedGameState",
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
            "version": "2018-05-29",
            "payload": {
            "state": "\${context.arguments.input.state}"
            }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        $util.toJson($context.result)
      `),
    });

    // 障害情報を伝える SNS Topic にサブスクリプションを作成する
    topicList.forEach((topic) => {
      topic.addSubscription(
        new cdk.aws_sns_subscriptions.LambdaSubscription(this.incidentFunction),
      );
    });

    // Output the AppSync API URL, API Key and ARN for reference
    new cdk.CfnOutput(this, "GraphQLApiURL", {
      value: this.api.graphqlUrl,
    });

    new cdk.CfnOutput(this, "GraphQLApiKey", {
      value: this.api.apiKey || "No API Key found",
    });

    new cdk.CfnOutput(this, "GraphQLApiARN", {
      value: this.api.arn,
      description: "AppSync API ARN",
    });
  }
}
