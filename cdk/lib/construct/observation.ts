import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { DatabaseCluster } from "aws-cdk-lib/aws-rds";
import { Instance } from "aws-cdk-lib/aws-ec2";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Trail } from "aws-cdk-lib/aws-cloudtrail";
import * as path from "path";
import { NagSuppressions } from "cdk-nag";

export interface ObservationProps extends cdk.StackProps {
  //親コンストラクトから受け取る変数型を記載
  gameStateTable: ddb.Table;
  resourceMappingTable: ddb.Table;
  securityScenarioTable: ddb.Table;
  resilienceScenarioTable: ddb.Table;
  loadBalancerDnsName: string;
  trail: Trail;
  trailLogBucket: Bucket;
  databaseCluster: DatabaseCluster;
  ec2Instances: Instance[];
  unsafeInstanceProfileArn: string;
}

export class Observation extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  constructor(scope: Construct, id: string, props: ObservationProps) {
    super(scope, id);

    const region = cdk.Stack.of(this).region;
    const account = cdk.Stack.of(this).account;

    //障害検知用stepfunction
    //gameIdを変数に格納
    const pass = sfn.Pass.jsonata(this, "pass", {
      assign: {
        gameId: "{% $states.input.dynamodb.OldImage.GameId.S %}",
      },
    });
    //demo-appの状態監視lambdaの並列実行ステート
    const observationParallel = sfn.Parallel.jsonata(
      this,
      "observationParallel",
    );

    const lambdaRole = new iam.Role(this, "LambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
      inlinePolicies: {
        ObservationLambdaPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeInstances",
                "ec2:DescribeInstanceStatus",
                "ec2:DescribeNetworkInterfaces",
                "s3:ListAllMyBuckets",
                "cloudtrail:DescribeTrails",
                "elasticloadbalancing:DescribeLoadBalancers",
                "elasticloadbalancing:DescribeTargetGroups",
                "elasticloadbalancing:DescribeTargetHealth",
                "elasticloadbalancing:DescribeListeners",
                "cloudwatch:GetMetricStatistics",
                "ssm:GetCommandInvocation",
                "ssm:ListCommandInvocations",
              ],
              resources: ["*"],
              effect: cdk.aws_iam.Effect.ALLOW,
            }),
            new cdk.aws_iam.PolicyStatement({
              actions: [
                "iam:GetRole",
                "iam:ListRolePolicies",
                "iam:GetRolePolicy",
                "iam:ListAttachedRolePolicies",
                "iam:GetInstanceProfile",
              ],
              resources: [
                ...props.ec2Instances.map(
                  (instance) =>
                    `arn:aws:iam::${account}:instance-profile/${instance.instance.iamInstanceProfile}`,
                ),
                props.unsafeInstanceProfileArn
              ],
              effect: cdk.aws_iam.Effect.ALLOW,
            }),
            new cdk.aws_iam.PolicyStatement({
              actions: [
                "s3:GetBucketPublicAccessBlock",
                "s3:GetBucketPolicy",
                "s3:GetBucketAcl",
              ],
              resources: [props.trailLogBucket.bucketArn],
              effect: cdk.aws_iam.Effect.ALLOW,
            }),
            new cdk.aws_iam.PolicyStatement({
              actions: [
                "rds:DescribeDBInstances",
                "rds:DescribeDBSecurityGroups",
              ],
              resources: [
                ...props.databaseCluster.instanceIdentifiers.map(
                  (instanceIdentifier) =>
                    `arn:aws:rds:${region}:${account}:db:${instanceIdentifier}`,
                ),
              ],
              effect: cdk.aws_iam.Effect.ALLOW,
            }),
            new cdk.aws_iam.PolicyStatement({
              actions: ["cloudtrail:GetTrailStatus"],
              resources: [props.trail.trailArn],
              effect: cdk.aws_iam.Effect.ALLOW,
            }),
            new cdk.aws_iam.PolicyStatement({
              actions: ["ssm:SendCommand"],
              resources: [
                ...props.ec2Instances.map(
                  (instance) =>
                    `arn:aws:ec2:${region}:${account}:instance/${instance.instanceId}`,
                ),
              ],
            }),
          ],
        }),
      },
    });

    const addLambdaBranch = (functionName: string) => {
      const lambdaFunction = new NodejsFunction(this, functionName, {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, `../../lambda/observer/${functionName}.ts`),
        timeout: cdk.Duration.seconds(45),
        memorySize: 1024,
        environment: {
          GAME_STATE_TABLE_NAME: props.gameStateTable.tableName,
          SECURITY_SCENARIO_TABLE_NAME: props.securityScenarioTable.tableName,
          RESILIENCE_SCENARIO_TABLE_NAME:
            props.resilienceScenarioTable.tableName,
          RESOURCE_MAPPING_TABLE_NAME: props.resourceMappingTable.tableName,
          LOADBALANCER_DNS_NAME: props.loadBalancerDnsName,
        },
        role: lambdaRole,
      });

      // Grant read and write permissions to DynamoDB tables
      props.gameStateTable.grantReadWriteData(lambdaFunction);
      props.securityScenarioTable.grantReadWriteData(lambdaFunction);
      props.resilienceScenarioTable.grantReadWriteData(lambdaFunction);
      props.resourceMappingTable.grantReadWriteData(lambdaFunction);

      const lambdaTask = tasks.LambdaInvoke.jsonata(
        this,
        `${functionName}Invoke`,
        {
          lambdaFunction: lambdaFunction,
          payload: sfn.TaskInput.fromObject({
            gameId: "{% $gameId %}",
          }),
          outputs: "{% $states.result.Payload %}",
        },
      );

      observationParallel.branch(lambdaTask);

      return lambdaFunction;
    };

    const functionNameArray = [
      "security-albsg",
      "security-cloudtrail",
      "security-ec2role",
      "security-ec2sg",
      "security-rdssg",
      "security-s3",
      "resilience-albsg",
      "resilience-ec2sg",
      "resilience-ec2",
      "resilience-ec2process",
    ];

    const functionsList = functionNameArray.map((functionName) => {
      return addLambdaBranch(functionName);
    });

    //ゲーム終了分岐
    const isGameEndChoice = sfn.Choice.jsonata(this, "isGameEndChoice");

    //ループが増えすぎないための待機
    const waitInLoop = sfn.Wait.jsonata(this, "Wait", {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(1)),
    });

    //lambdaからsolvedがbooleanで返却される
    const isGameEndCondition = sfn.Condition.jsonata(
      "{% $count($filter($states.input, function($v) {$v.solved})) = $count($states.input) %}",
    );

    //ゲーム終了をdynamodbに通知
    const notifyGameEnd = tasks.DynamoUpdateItem.jsonata(
      this,
      "nofityGameEnd",
      {
        key: {
          GameId: tasks.DynamoAttributeValue.fromString("{% $gameId %}"),
        },
        table: props.gameStateTable,
        expressionAttributeNames: {
          "#State": "State",
        },
        expressionAttributeValues: {
          ":nextState": tasks.DynamoAttributeValue.fromString("Ready"),
        },
        updateExpression: "SET #State = :nextState",
      },
    );

    const chain = sfn.DefinitionBody.fromChainable(
      pass.next(
        observationParallel.next(
          isGameEndChoice
            .when(isGameEndCondition, notifyGameEnd)
            .otherwise(waitInLoop.next(observationParallel)),
        ),
      ),
    );

    const stateMachine = new sfn.StateMachine(this, "observationStateMachine", {
      definitionBody: chain,
    });

    this.stateMachine = stateMachine;

    /**
     * CDK-NAG Suppressions
     */
    NagSuppressions.addResourceSuppressions(this.stateMachine, [
      {
        id: "AwsSolutions-SF1",
        reason:
          "Logging is disabled. Because this is a game. No needs logging.",
      },
      {
        id: "AwsSolutions-SF2",
        reason:
          "Tracing is disabled. Because this is a game. No needs tracing.",
      },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${this.stateMachine.role.node.path}/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "These permissions are required for the state machine to invoke Lambda functions with specific ARNs.",
          appliesTo: [
            "Resource::<Observationresiliencealbsg2FD13266.Arn>:*",
            "Resource::<Observationresilienceec2BD206296.Arn>:*",
            "Resource::<Observationresilienceec2processEC9EF61A.Arn>:*",
            "Resource::<Observationresilienceec2sg0BE0F1B5.Arn>:*",
            "Resource::<Observationsecurityalbsg27A4FBEE.Arn>:*",
            "Resource::<Observationsecuritycloudtrail70F3771B.Arn>:*",
            "Resource::<Observationsecurityec2role0EFF0958.Arn>:*",
            "Resource::<Observationsecurityec2sg95EF523A.Arn>:*",
            "Resource::<Observationsecurityrdssg8F13F0F8.Arn>:*",
            "Resource::<Observationsecuritys322BB38DD.Arn>:*",
          ],
        },
      ],
    );
    NagSuppressions.addResourceSuppressions(lambdaRole, [
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
