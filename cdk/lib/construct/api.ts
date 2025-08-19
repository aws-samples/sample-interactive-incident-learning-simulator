import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";
import { ApiKeyAuthorizer } from "./api-key-authorizer";

export interface ApiProps extends cdk.StackProps {
  // 親スタックから受け取る変数型を記載
  resilienceEasyFunction: lambda.NodejsFunction;
  resilienceHardFunction: lambda.NodejsFunction;
  securityEasyFunction: lambda.NodejsFunction;
  securityHardFunction: lambda.NodejsFunction;
  resetFunction: lambda.NodejsFunction;
}

export class Api extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly apiKeyAuth: ApiKeyAuthorizer;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    // Authorizer
    this.apiKeyAuth = new ApiKeyAuthorizer(this, "ApiAuthorizer");

    // API Gatewayの作成
    this.api = new apigateway.RestApi(this, "InteractiveIncidentLearningSimulatorApi", {
      restApiName: "Interactive Incident Learning Simulator Api",
      description: "API for failure injection scenarios",
      deployOptions: {
        stageName: "prod",
        // CloudWatchログは無効化
        loggingLevel: apigateway.MethodLoggingLevel.OFF,
        dataTraceEnabled: false,
        metricsEnabled: false,
      },
      // CORSの設定
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
        allowCredentials: true,
      },
    });

    // APIのルートリソースにメッセージを表示
    const rootResource = this.api.root.addResource("api");
    rootResource.addMethod(
      "GET",
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              "application/json": '{ "message": "Welcome to Simulator API" }',
            },
          },
        ],
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        requestTemplates: {
          "application/json": '{ "statusCode": 200 }',
        },
      }),
      {
        methodResponses: [{ statusCode: "200" }],
      },
    );

    const lambdaIntegrationOptions: apigateway.LambdaIntegrationOptions = {
      proxy: true,
      integrationResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": "'*'",
            "method.response.header.Access-Control-Allow-Headers":
              "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
            "method.response.header.Access-Control-Allow-Methods":
              "'OPTIONS,POST,GET'",
          },
        },
      ],
    };
    const methodOptions: apigateway.MethodOptions = {
      authorizer: this.apiKeyAuth.lambdaAuthorizer, // APIキー認証を追加
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
            "method.response.header.Access-Control-Allow-Headers": true,
            "method.response.header.Access-Control-Allow-Methods": true,
          },
        },
        {
          statusCode: "400",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
            "method.response.header.Access-Control-Allow-Headers": true,
            "method.response.header.Access-Control-Allow-Methods": true,
          },
        },
        {
          statusCode: "401", // 認証エラー用のレスポンスを追加
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
            "method.response.header.Access-Control-Allow-Headers": true,
            "method.response.header.Access-Control-Allow-Methods": true,
          },
        },
        {
          statusCode: "500",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
            "method.response.header.Access-Control-Allow-Headers": true,
            "method.response.header.Access-Control-Allow-Methods": true,
          },
        },
      ],
    };

    // セキュリティシナリオのEasyモード用エンドポイント
    const secEasyResource = rootResource.addResource("sec-easy");
    secEasyResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(
        props.securityEasyFunction,
        lambdaIntegrationOptions,
      ),
      methodOptions,
    );

    // セキュリティシナリオのHardモード用エンドポイント
    const secHardResource = rootResource.addResource("sec-hard");
    secHardResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(
        props.securityHardFunction,
        lambdaIntegrationOptions,
      ),
      methodOptions,
    );

    // レジリエンスシナリオのEasyモード用エンドポイント
    const resEasyResource = rootResource.addResource("res-easy");
    resEasyResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(
        props.resilienceEasyFunction,
        lambdaIntegrationOptions,
      ),
      methodOptions,
    );

    // レジリエンスシナリオのHardモード用エンドポイント
    const resHardResource = rootResource.addResource("res-hard");
    resHardResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(
        props.resilienceHardFunction,
        lambdaIntegrationOptions,
      ),
      methodOptions,
    );

    // ゲームリセット用エンドポイント
    const gameResetResource = rootResource.addResource("game-reset");
    gameResetResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(
        props.resetFunction,
        {
          requestParameters: {
            'integration.request.header.X-Amz-Invocation-Type': "'Event'"
          },
          proxy: false,
          integrationResponses: [
            {
              statusCode: "202",
              responseParameters: {
                "method.response.header.Access-Control-Allow-Origin": "'*'",
                "method.response.header.Access-Control-Allow-Headers":
                  "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
                "method.response.header.Access-Control-Allow-Methods":
                  "'OPTIONS,POST,GET'",
              },
            },
          ],
        },
      ),
      {
        authorizer: this.apiKeyAuth.lambdaAuthorizer, // APIキー認証を追加
        methodResponses: [
          {
            statusCode: "202",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
              "method.response.header.Access-Control-Allow-Headers": true,
              "method.response.header.Access-Control-Allow-Methods": true,
            },
          },
          {
            statusCode: "400",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
              "method.response.header.Access-Control-Allow-Headers": true,
              "method.response.header.Access-Control-Allow-Methods": true,
            },
          },
          {
            statusCode: "401", // 認証エラー用のレスポンスを追加
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
              "method.response.header.Access-Control-Allow-Headers": true,
              "method.response.header.Access-Control-Allow-Methods": true,
            },
          },
          {
            statusCode: "500",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
              "method.response.header.Access-Control-Allow-Headers": true,
              "method.response.header.Access-Control-Allow-Methods": true,
            },
          },
        ],
      }
    );

    // API Gatewayからのリソースポリシーを追加
    const apiGatewayPrincipal = new iam.ServicePrincipal(
      "apigateway.amazonaws.com",
    );

    props.securityEasyFunction.addPermission("ApiGatewayInvokeSecurityEasy", {
      principal: apiGatewayPrincipal,
      sourceArn: this.api.arnForExecuteApi("POST", secEasyResource.path),
    });

    props.securityHardFunction.addPermission("ApiGatewayInvokeSecurityHard", {
      principal: apiGatewayPrincipal,
      sourceArn: this.api.arnForExecuteApi("POST", secHardResource.path),
    });

    props.resilienceEasyFunction.addPermission(
      "ApiGatewayInvokeResilienceEasy",
      {
        principal: apiGatewayPrincipal,
        sourceArn: this.api.arnForExecuteApi("POST", resEasyResource.path),
      },
    );

    props.resilienceHardFunction.addPermission(
      "ApiGatewayInvokeResilienceHard",
      {
        principal: apiGatewayPrincipal,
        sourceArn: this.api.arnForExecuteApi("POST", resHardResource.path),
      },
    );

    props.resetFunction.addPermission("ApiGatewayInvokeReset", {
      principal: apiGatewayPrincipal,
      sourceArn: this.api.arnForExecuteApi("POST", gameResetResource.path),
    });

    // API URLの出力
    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.url,
      description: "URL of the API",
    });

    /**
     * CDK-NAG Suppressions
     */
    NagSuppressions.addResourceSuppressions(this.api, [
      {
        id: "AwsSolutions-APIG2",
        reason: "Request validations are implemented in each lambda functions.",
      },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `/${this.api.node.path}/DeploymentStage.prod/Resource`,
      [
        {
          id: "AwsSolutions-APIG1",
          reason:
            "Logging is disabled. Because this is a game. No needs logging.",
        },
        {
          id: "AwsSolutions-APIG6",
          reason:
            "Logging is disabled. Because this is a game. No needs logging.",
        },
      ],
    );
    const methodResources = [
      rootResource.node.findChild("GET").node.findChild("Resource"),
      secEasyResource.node.findChild("POST").node.findChild("Resource"),
      secHardResource.node.findChild("POST").node.findChild("Resource"),
      resEasyResource.node.findChild("POST").node.findChild("Resource"),
      resHardResource.node.findChild("POST").node.findChild("Resource"),
      gameResetResource.node.findChild("POST").node.findChild("Resource"),
    ];

    methodResources.forEach((resource) => {
      NagSuppressions.addResourceSuppressions(resource, [
        {
          id: "AwsSolutions-COG4",
          reason:
            "This is a temporary game application with limited lifespan. Cognito user pool is not required.",
        },
      ]);
    });
    NagSuppressions.addResourceSuppressions(methodResources[0], [
      {
        id: "AwsSolutions-APIG4",
        reason:
          "This is a welcome message endpoint that does not require authentication.",
      },
    ]);
  }
}
