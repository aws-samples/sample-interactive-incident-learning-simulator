import { Construct } from "constructs";
import { Duration, Stack } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { randomBytes } from "crypto";
import { NagSuppressions } from "cdk-nag/lib/nag-suppressions";

export class ApiKeyAuthorizer extends Construct {
  public readonly apikeyString: string;
  public readonly lambdaAuthorizer: apigateway.RequestAuthorizer;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Lambda オーソライザー の認証で利用する文字列の生成
    this.apikeyString = randomBytes(25).reduce(
      (p, i) => p + (i % 36).toString(36),
      "",
    );

    // Lambda オーソライザーの追加
    const authorizerFunction = new nodejs.NodejsFunction(
      scope,
      "authorizer-function",
      {
        entry: path.join(__dirname, "../../lambda/apigw-authorizer/index.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_22_X,
        memorySize: 1024,
        bundling: {
          bundleAwsSDK: true,
        },
        timeout: Duration.seconds(10),
        environment: {
          APIKEY: this.apikeyString,
        },
      },
    );

    authorizerFunction.addPermission("authorizer-function-permission", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
    });

    this.lambdaAuthorizer = new apigateway.RequestAuthorizer(
      scope,
      "Authorizer",
      {
        handler: authorizerFunction,
        identitySources: [apigateway.IdentitySource.header("Authorization")],
        resultsCacheTtl: Duration.minutes(0),
      },
    );

    /**
     * CDK-NAG Suppressions
     */
    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${authorizerFunction.node.path}/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWSLambdaBasicExecutionRole provides minimal permissions for CloudWatch logging only",
        },
      ],
    );
  }
}
