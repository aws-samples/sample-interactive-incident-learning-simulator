import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { Stack } from "aws-cdk-lib";
import { Trail } from "aws-cdk-lib/aws-cloudtrail";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";

export interface FailureInjectionProps extends cdk.StackProps {
  // 親スタックから受け取る変数型を記載
  gameStateTable: ddb.Table;
  securityScenarioTable: ddb.Table;
  resilienceScenarioTable: ddb.Table;
  resourceMappingTable: ddb.Table;
  ec2Instances: ec2.Instance[];
  trail: Trail;
  trailLogBucket: Bucket;
  albSecurityGroup: ec2.SecurityGroup;
  ec2SecurityGroup: ec2.SecurityGroup;
  auroraSecurityGroup: ec2.ISecurityGroup;
  observationStateMachine: sfn.StateMachine;
}

export class FailureInjection extends Construct {
  public readonly resilienceEasyFunction: NodejsFunction;
  public readonly resilienceHardFunction: NodejsFunction;
  public readonly securityEasyFunction: NodejsFunction;
  public readonly securityHardFunction: NodejsFunction;
  public readonly resetFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: FailureInjectionProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const stackName = Stack.of(this).stackName;

    // レジリエンス関連のAWSリソースを操作するための権限を定義
    const resilienceDescribePolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ec2:DescribeInstances",
        "ec2:DescribeSecurityGroups",
        "ssm:GetCommandInvocation",
      ],
      resources: ["*"], // 上記の Action はリソースを制限できないため、CDK-NAG では Suppress する
    });
    const resilienceControlPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ec2:StopInstances",
        "ec2:StartInstances",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
        "ssm:SendCommand",
      ],
      resources: [
        ...props.ec2Instances.map(
          (instance) =>
            `arn:aws:ec2:${region}:${account}:instance/${instance.instanceId}`,
        ),
        // セキュリティグループのARNを追加
        `arn:aws:ec2:${region}:${account}:security-group/${props.albSecurityGroup.securityGroupId}`,
        `arn:aws:ec2:${region}:${account}:security-group/${props.ec2SecurityGroup.securityGroupId}`,
        `arn:aws:ec2:${region}:${account}:security-group/${props.auroraSecurityGroup.securityGroupId}`,
        // SSMドキュメントのARNを追加（SendCommandに必要）
        `arn:aws:ssm:${region}::document/AWS-RunShellScript`,

      ],
    });
    const resilienceRole = new iam.Role(this, "ResilienceRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
      inlinePolicies: {
        resiliencePolicies: new iam.PolicyDocument({
          statements: [
            resilienceDescribePolicyStatement,
            resilienceControlPolicyStatement,
          ],
        }),
      },
    });

    // レジリエンスシナリオのEasyモード用Lambda関数
    this.resilienceEasyFunction = new NodejsFunction(
      this,
      "ResilienceEasyFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, "../../lambda/resilience/easy.ts"),
        timeout: cdk.Duration.seconds(30),
        role: resilienceRole,
        environment: {
          GAME_STATE_TABLE_NAME: props.gameStateTable.tableName,
          RESILIENCE_SCENARIO_TABLE_NAME:
            props.resilienceScenarioTable.tableName,
          RESOURCE_MAPPING_TABLE_NAME: props.resourceMappingTable.tableName,
          STACK_NAME: stackName,
          AWS_ACCOUNT_ID: account,
        },
      },
    );

    // DynamoDBテーブルへのアクセス権限を付与
    props.gameStateTable.grantReadWriteData(this.resilienceEasyFunction);
    props.resilienceScenarioTable.grantReadWriteData(
      this.resilienceEasyFunction,
    );
    props.resourceMappingTable.grantReadData(this.resilienceEasyFunction);

    // レジリエンスシナリオのHardモード用Lambda関数
    this.resilienceHardFunction = new NodejsFunction(
      this,
      "ResilienceHardFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, "../../lambda/resilience/hard.ts"),
        timeout: cdk.Duration.seconds(30),
        role: resilienceRole,
        environment: {
          GAME_STATE_TABLE_NAME: props.gameStateTable.tableName,
          RESILIENCE_SCENARIO_TABLE_NAME:
            props.resilienceScenarioTable.tableName,
          RESOURCE_MAPPING_TABLE_NAME: props.resourceMappingTable.tableName,
          STACK_NAME: stackName,
          AWS_ACCOUNT_ID: account,
        },
      },
    );

    // DynamoDBテーブルへのアクセス権限を付与
    props.gameStateTable.grantReadWriteData(this.resilienceHardFunction);
    props.resilienceScenarioTable.grantReadWriteData(
      this.resilienceHardFunction,
    );
    props.resourceMappingTable.grantReadData(this.resilienceHardFunction);

    // セキュリティ関連のAWSリソースを操作するための権限を定義
    const securityDescribePolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeInstances",
        "ec2:DescribeIamInstanceProfileAssociations",
        "iam:ListRolePolicies",
        "iam:PassRole",
        "cloudtrail:DescribeTrails",
      ],
      resources: ["*"],
    });

    const securityCfnControlPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cloudformation:DescribeStacks"],
      resources: [Stack.of(this).stackId],
    });

    const securityEc2ControlPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
        "ec2:StopInstances",
        "ec2:StartInstances",
        "ec2:ReplaceIamInstanceProfileAssociation",
      ],
      resources: [
        ...props.ec2Instances.map(
          (instance) =>
            `arn:aws:ec2:${region}:${account}:instance/${instance.instanceId}`,
        ),
        // セキュリティグループのARNを追加
        `arn:aws:ec2:${region}:${account}:security-group/${props.albSecurityGroup.securityGroupId}`,
        `arn:aws:ec2:${region}:${account}:security-group/${props.ec2SecurityGroup.securityGroupId}`,
        `arn:aws:ec2:${region}:${account}:security-group/${props.auroraSecurityGroup.securityGroupId}`,
        // IAMインスタンスプロファイル操作に必要なリソースを追加
        // セキュリティシナリオでSafeRole/UnsafeRoleの切り替えに必要
        `arn:aws:iam::${account}:instance-profile/*`,
      ],
    });

    const securityS3ControlPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "s3:PutBucketPublicAccessBlock",
        "s3:GetBucketPublicAccessBlock",
      ],
      resources: [
        props.trailLogBucket.bucketArn,
        // S3バケット操作では、バケット内のオブジェクトへのアクセスも必要な場合がある
        `${props.trailLogBucket.bucketArn}/*`,
      ],
    });

    const securityTrailControlPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "cloudtrail:StopLogging",
        "cloudtrail:StartLogging",
        "cloudtrail:UpdateTrail",
        "cloudtrail:GetTrailStatus",
      ],
      resources: [props.trail.trailArn], // 本番環境では適切に制限することを推奨
    });

    // Step Functions実行を停止するための権限を定義
    const stepFunctionsControlPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "states:ListExecutions",
        "states:StopExecution",
      ],
      resources: ["*"], // Step Functions State Machine ARNは動的に決まるため、リソースを制限できない
    });

    const securityRole = new iam.Role(this, "SecurityRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
      inlinePolicies: {
        securityPolicies: new iam.PolicyDocument({
          statements: [
            securityDescribePolicyStatement,
            securityCfnControlPolicyStatement,
            securityS3ControlPolicyStatement,
            securityEc2ControlPolicyStatement,
            securityTrailControlPolicyStatement,
          ],
        }),
      },
    });

    // セキュリティシナリオのEasyモード用Lambda関数
    this.securityEasyFunction = new NodejsFunction(
      this,
      "SecurityEasyFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, "../../lambda/security/easy.ts"),
        role: securityRole,
        timeout: cdk.Duration.seconds(180),
        environment: {
          GAME_STATE_TABLE_NAME: props.gameStateTable.tableName,
          SECURITY_SCENARIO_TABLE_NAME: props.securityScenarioTable.tableName,
          RESOURCE_MAPPING_TABLE_NAME: props.resourceMappingTable.tableName,
          STACK_NAME: stackName,
          AWS_ACCOUNT_ID: account,
        },
      },
    );

    // DynamoDBテーブルへのアクセス権限を付与
    props.gameStateTable.grantReadWriteData(this.securityEasyFunction);
    props.securityScenarioTable.grantReadWriteData(this.securityEasyFunction);
    props.resourceMappingTable.grantReadData(this.securityEasyFunction);

    // セキュリティシナリオのHardモード用Lambda関数
    this.securityHardFunction = new NodejsFunction(
      this,
      "SecurityHardFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, "../../lambda/security/hard.ts"),
        role: securityRole,
        timeout: cdk.Duration.seconds(180),
        environment: {
          GAME_STATE_TABLE_NAME: props.gameStateTable.tableName,
          SECURITY_SCENARIO_TABLE_NAME: props.securityScenarioTable.tableName,
          RESOURCE_MAPPING_TABLE_NAME: props.resourceMappingTable.tableName,
          STACK_NAME: stackName,
          AWS_ACCOUNT_ID: account,
        },
      },
    );

    // DynamoDBテーブルへのアクセス権限を付与
    props.gameStateTable.grantReadWriteData(this.securityHardFunction);
    props.securityScenarioTable.grantReadWriteData(this.securityHardFunction);
    props.resourceMappingTable.grantReadData(this.securityHardFunction);

    // リセット用の権限を付与（セキュリティとレジリエンスの両方の権限を付与）
    const resetRole = new iam.Role(this, "ResetRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
      inlinePolicies: {
        resetPolicies: new iam.PolicyDocument({
          statements: [
            resilienceDescribePolicyStatement,
            resilienceControlPolicyStatement,
            securityDescribePolicyStatement,
            securityCfnControlPolicyStatement,
            securityEc2ControlPolicyStatement,
            securityS3ControlPolicyStatement,
            securityTrailControlPolicyStatement,
            stepFunctionsControlPolicyStatement,
          ],
        }),
      },
    });

    // ゲームリセット用Lambda関数
    this.resetFunction = new NodejsFunction(this, "ResetFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../../lambda/reset/index.ts"),
      role: resetRole,
      timeout: cdk.Duration.seconds(180), // リセット処理は時間がかかる可能性があるため長めに設定
      environment: {
        GAME_STATE_TABLE_NAME: props.gameStateTable.tableName,
        SECURITY_SCENARIO_TABLE_NAME: props.securityScenarioTable.tableName,
        RESILIENCE_SCENARIO_TABLE_NAME: props.resilienceScenarioTable.tableName,
        RESOURCE_MAPPING_TABLE_NAME: props.resourceMappingTable.tableName,
        OBSERVATION_STATE_MACHINE_ARN: props.observationStateMachine.stateMachineArn,
        STACK_NAME: stackName,
        AWS_ACCOUNT_ID: account,
      },
    });

    // DynamoDBテーブルへのアクセス権限を付与
    props.gameStateTable.grantReadWriteData(this.resetFunction);
    props.securityScenarioTable.grantReadWriteData(this.resetFunction);
    props.resilienceScenarioTable.grantReadWriteData(this.resetFunction);
    props.resourceMappingTable.grantReadData(this.resetFunction);

    // StepFunctionの実行権限を付与
    props.observationStateMachine.grantStartExecution(this.resetFunction);

    /**
     * CDK-NAG Suppressions
     */
    NagSuppressions.addResourceSuppressions(resilienceRole, [
      {
        id: "AwsSolutions-IAM4",
        reason: "service-role/AWSLambdaBasicExecutionRole made simple lambda function role."
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "These actions require * resource.",
      },
    ]);
    NagSuppressions.addResourceSuppressions(securityRole, [
      {
        id: "AwsSolutions-IAM4",
        reason: "service-role/AWSLambdaBasicExecutionRole made simple lambda function role."
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "These actions require * resource.",
      },
    ]);
    NagSuppressions.addResourceSuppressions(resetRole, [
      {
        id: "AwsSolutions-IAM4",
        reason: "service-role/AWSLambdaBasicExecutionRole made simple lambda function role."
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "These actions require * resource.",
      },
    ]);
  }
}
