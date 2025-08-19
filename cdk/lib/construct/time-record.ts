/**
 * タイマー情報を保存するための APIGW + Lambda + DynamoDB を作成する
 */
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import { NagSuppressions } from "cdk-nag";
import * as path from "path";
import { ApiKeyAuthorizer } from "./api-key-authorizer";

export class TimeRecord extends Construct {
  public readonly recordAPIGWEndpointUrl: string;
  public readonly recordAPIGWAPIKey: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // DynamoDB
    const table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "time", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timer", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // pattern#mode から順位得られるように GSI 作成する
    table.addGlobalSecondaryIndex({
      indexName: "patternMode",
      partitionKey: {
        name: "patternMode",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "timer", type: dynamodb.AttributeType.NUMBER },
    });

    // Lambda
    const TimeRecordFunction = new nodejs.NodejsFunction(
      this,
      "TimeRecordFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.handler",
        entry: path.join(__dirname, "../../lambda/time-record/index.ts"),
        bundling: {
          bundleAwsSDK: true,
        },
        timeout: Duration.seconds(30),
        memorySize: 256,
        description: "Lambda function to handle time record operations",
        environment: {
          TABLE_NAME: table.tableName,
        },
      },
    );

    const DDBPolicy = new iam.PolicyStatement({
      actions: [
        "dynamodb:DeleteItem",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:Scan",
      ],
      effect: iam.Effect.ALLOW,
      resources: [
        table.tableArn,
        `${table.tableArn}/index/patternMode`, // GSIへのアクセス権限も追加
      ],
    });

    const lambdaRole = TimeRecordFunction.role as iam.Role;
    lambdaRole.addToPolicy(DDBPolicy);

    // Authorizer
    const apiKeyAuthorizer = new ApiKeyAuthorizer(
      this,
      "TimeRecordApiKeyAuthorizer",
    );

    // Access Log
    const logGroupAPIGWAccessLog = new logs.LogGroup(
      this,
      "ApiGatewayAccessLogs",
      {
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    const ApiGatewayCloudWatchLogRole = new iam.Role(
      this,
      "ApiGatewayLogsRole",
      {
        roleName: "api-gateway-logs-role",
        assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonAPIGatewayPushToCloudWatchLogs",
          ),
        ],
        maxSessionDuration: Duration.hours(1),
      },
    );

    // アクセスログの出力で利用する
    new apigateway.CfnAccount(this, "ApiGatewayCfnAccount", {
      cloudWatchRoleArn: ApiGatewayCloudWatchLogRole.roleArn,
    });

    // API Gateway
    const TimeRecordAPI = new apigateway.LambdaRestApi(this, "TimeReocrdApi", {
      handler: TimeRecordFunction,
      proxy: false,
      // APIキーをすべてのメソッドに対して必須に設定
      defaultMethodOptions: {
        authorizer: apiKeyAuthorizer.lambdaAuthorizer,
        authorizationType: apigateway.AuthorizationType.CUSTOM,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      deployOptions: {
        //実行ログの設定
        dataTraceEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        //アクセスログの有効化
        accessLogDestination: new apigateway.LogGroupLogDestination(
          logGroupAPIGWAccessLog,
        ),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
      },
    });

    // タイマーを記録するリソース
    const recordResource = TimeRecordAPI.root.addResource("record-ranking");
    recordResource.addMethod("POST", undefined, {
      requestValidator: new apigateway.RequestValidator(
        this,
        "APIGWRequestValidatorPOST",
        {
          restApi: TimeRecordAPI,
          // the properties below are optional
          requestValidatorName: "FrontAPIRequestValidatorPost",
          validateRequestParameters: true,
        },
      ),
    });

    //上位のタイマーを記録するリソース
    const topRecordResource = TimeRecordAPI.root.addResource("get-rankings");
    topRecordResource.addMethod("GET", undefined, {
      requestParameters: {
        "method.request.querystring.mode": true,
      },
      requestValidator: new apigateway.RequestValidator(
        this,
        "APIGWRequestValidatorGET",
        {
          restApi: TimeRecordAPI,
          // the properties below are optional
          requestValidatorName: "FrontAPIRequestValidatorGet",
          validateRequestParameters: true,
        },
      ),
    });

    this.recordAPIGWEndpointUrl = TimeRecordAPI.url;
    this.recordAPIGWAPIKey = apiKeyAuthorizer.apikeyString;

    /**
     * CDK-NAG Suppressions
     */
    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${TimeRecordAPI.node.path}/Default/record-ranking/POST/Resource`,
      [
        {
          id: "AwsSolutions-COG4",
          reason:
            "This application is for casual gaming enjoyment. Since user management is not anticipated, Cognito authentication is not required.",
        },
      ],
    );

    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${TimeRecordAPI.node.path}/Default/get-rankings/GET/Resource`,
      [
        {
          id: "AwsSolutions-COG4",
          reason:
            "This application is for casual gaming enjoyment. Since user management is not anticipated, Cognito authentication is not required.",
        },
      ],
    );

    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${TimeRecordFunction.node.path}/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWSLambdaBasicExecutionRole provides minimal permissions for CloudWatch logging only",
        },
      ],
    );

    NagSuppressions.addResourceSuppressions(ApiGatewayCloudWatchLogRole, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "ApiGatewayLogsRole provides minimal permissions for CloudWatch logging only",
      },
    ]);

    NagSuppressions.addResourceSuppressions(TimeRecordAPI, [
      {
        id: "AwsSolutions-APIG2",
        reason:
          "Request validation is implemented in the Lambda function with comprehensive input validation including required field checks, data type validation, and value range validation. This provides deeper validation than basic API Gateway request validation.",
      },
    ]);
  }
}
