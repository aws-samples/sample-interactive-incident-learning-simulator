import * as cdk from "aws-cdk-lib";
import { Stack, RemovalPolicy, CfnResource } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  CloudFrontToS3,
  CloudFrontToS3Props,
} from "@aws-solutions-constructs/aws-cloudfront-s3";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { NodejsBuild } from "deploy-time-build";
import * as s3 from "aws-cdk-lib/aws-s3";
import { ComputeType } from "aws-cdk-lib/aws-codebuild";
import { BucketDeployment } from "aws-cdk-lib/aws-s3-deployment";
import { NagSuppressions } from "cdk-nag";
import path = require("path");

export interface WebProps {
  recordAPIGWEndpointUrl: string;
  incidentAPIGWEndpointUrl: string;
  recordAPIGWAPIKey: string;
  incidentAPIGWAPIKey: string;
  appsyncAPIEndpointURL: string;
  appsyncAPIKey: string;
  appsyncAPIArn: string;
}

export class Web extends Construct {
  public readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id);

    const commonBucketProps: s3.BucketProps = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      enforceSSL: true,
      versioned: false,
    };

    // ホスティングで利用する CloudFront + S3 オブジェクトの作成
    const cloudFrontToS3Props: CloudFrontToS3Props = {
      insertHttpSecurityHeaders: false,
      loggingBucketProps: commonBucketProps,
      bucketProps: commonBucketProps,
      cloudFrontLoggingBucketProps: commonBucketProps,
      cloudFrontLoggingBucketAccessLogBucketProps: commonBucketProps,
      cloudFrontDistributionProps: {
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
        ],
      },
    };

    const { cloudFrontWebDistribution, s3BucketInterface } = new CloudFrontToS3(
      this,
      "Web",
      cloudFrontToS3Props,
    );

    // ThirdParty の Frontend Application ビルドのライブラリを利用
    const build = new NodejsBuild(this, "BuildWeb", {
      assets: [
        {
          path: path.join(__dirname, "../../../webapp"),
          exclude: [".gitignore", "*.md", "node_modules"],
        },
      ],
      destinationBucket: s3BucketInterface,
      distribution: cloudFrontWebDistribution,
      outputSourceDirectory: "./dist",
      buildCommands: ["npm install", "npm run build"],
      buildEnvironment: {
        NODE_OPTIONS: "--max-old-space-size=4096", // デプロイ時のCodeBuildのメモリを設定
        VITE_APP_APIGW_RECORD_ENDPOINT: props.recordAPIGWEndpointUrl,
        VITE_APP_APIGW_INCIDENT_ENDPOINT: props.incidentAPIGWEndpointUrl,
        VITE_APP_APIGW_RECORD_API_KEY: props.recordAPIGWAPIKey,
        VITE_APP_APIGW_INCIDENT_API_KEY: props.incidentAPIGWAPIKey,
        VITE_APP_REGION: Stack.of(this).region,
        VITE_APP_APPSYNC_URL: props.appsyncAPIEndpointURL,
        VITE_APP_APPSYNC_API_KEY: props.appsyncAPIKey,
        VITE_APP_APPSYNC_ARN: props.appsyncAPIArn,
      },
    });
    (
      build.node.findChild("Project").node.defaultChild as CfnResource
    ).addPropertyOverride("Environment.ComputeType", ComputeType.MEDIUM);

    NagSuppressions.addResourceSuppressions(
      build,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "CodeBuild requires wildcard permissions for CDK asset S3 buckets, CloudWatch logs, and CodeBuild reports. These are standard AWS patterns for CodeBuild projects.",
        },
        {
          id: "AwsSolutions-CB4",
          reason:
            "CodeBuild project is used for frontend build process and does not require KMS encryption for this use case.",
        },
      ],
      true, // applyToChildren = true
    );

    // CloudFront distribution のセキュリティ警告を抑制
    NagSuppressions.addResourceSuppressions(
      cloudFrontWebDistribution,
      [
        {
          id: "AwsSolutions-CFR4",
          reason:
            "This is a temporary deployment application. Custom domain and SSL certificate setup is not feasible for this use case. The application uses CloudFront default domain which requires allowing legacy SSL/TLS versions for backward compatibility. In production environments, custom domain with proper SSL certificate should be configured.",
        },
        {
          id: "AwsSolutions-CFR1",
          reason:
            "Geo restrictions are not required for this temporary deployment application. This is a training/demo environment that needs to be accessible globally.",
        },
        {
          id: "AwsSolutions-CFR2",
          reason:
            "AWS WAF integration is not required for this temporary deployment application. This is a training/demo environment with limited exposure.",
        },
        {
          id: "AwsSolutions-CFR7",
          reason:
            "Origin Access Control (OAC) is properly configured by the AWS Solutions Constructs library. The warning is triggered by the presence of empty S3OriginConfig in the CloudFormation template, but the actual implementation uses OAC as confirmed by the OriginAccessControlId reference in the distribution configuration.",
        },
      ],
      true, // applyToChildren = true
    );

    // ToDo: cdk destory で削除できなかったが、エラー見る感じ以下のバグを踏んでいそう。ライブラリ使っているので、そのままのワークアラウンド適用できず検討必要。暫定的な回避としては CloudFront のリソース管理で使われている Custom::CDKBucketDeployment... > CustomCDKBucketDeployment... で始まる Lambda 関数に CloudFront の権限を付与してもらえると削除できる
    // https://github.com/aws/aws-cdk/issues/33762
    const deployment = build.node.findChild("Deploy").node
      .defaultChild as BucketDeployment;
    deployment?.handlerRole.addToPrincipalPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "cloudfront:GetInvalidation",
          "cloudfront:CreateInvalidation",
        ],
        resources: ["*"],
      }),
    );

    this.distribution = cloudFrontWebDistribution;
  }
}
