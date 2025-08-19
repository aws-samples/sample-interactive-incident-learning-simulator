import * as cdk from "aws-cdk-lib";
import { aws_pipes as pipes } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";

export interface EventsProps extends cdk.StackProps {
  //親スタックから受け取る変数型を記載
  gameStateTable: ddb.Table;
  securityScenarioTable: ddb.Table;
  resilienceScenarioTable: ddb.Table;
  sfnStateMachine: sfn.StateMachine;
}

export class Events extends Construct {
  public readonly topicList: sns.Topic[] = [];
  constructor(scope: Construct, id: string, props: EventsProps) {
    super(scope, id);

    // Create SNS topics for security and resilience scenarios
    const securityScenarioTopic = new sns.Topic(this, "SecurityScenarioTopic", {
      displayName: "Security Scenario Notifications",
      enforceSSL: true,
    });
    this.topicList.push(securityScenarioTopic);

    const resilienceScenarioTopic = new sns.Topic(
      this,
      "ResilienceScenarioTopic",
      {
        displayName: "Resilience Scenario Notifications",
        enforceSSL: true,
      },
    );
    this.topicList.push(resilienceScenarioTopic);

    // Create a new SNS topic for GameState changes
    const gameStateChangeTopic = new sns.Topic(this, "GameStateChangeTopic", {
      displayName: "Game State Change Notifications",
      enforceSSL: true,
    });
    this.topicList.push(gameStateChangeTopic);

    // Create a role for EventBridge Pipes with necessary permissions
    const pipeRole = new iam.Role(this, "pipeRole", {
      assumedBy: new iam.ServicePrincipal("pipes.amazonaws.com"),
      description:
        "Role for EventBridge Pipes to access DynamoDB streams and publish to SNS",
      inlinePolicies: {
        DynamoDBStreamAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "dynamodb:DescribeStream",
                "dynamodb:GetRecords",
                "dynamodb:GetShardIterator",
                "dynamodb:ListStreams",
                "dynamodb:ListShards",
              ],
              resources: [
                props.gameStateTable.tableStreamArn!,
                props.securityScenarioTable.tableStreamArn!,
                props.resilienceScenarioTable.tableStreamArn!,
              ],
            }),
          ],
        }),
        SNSPublish: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["sns:Publish"],
              resources: [
                securityScenarioTopic.topicArn,
                resilienceScenarioTopic.topicArn,
                gameStateChangeTopic.topicArn,
              ],
            }),
          ],
        }),
        StepFunctionsExecution: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["states:StartExecution"],
              resources: [props.sfnStateMachine.stateMachineArn],
            }),
          ],
        }),
      },
    });

    // Filter rule for game state changes (Ready -> Ongoing)
    const filterRuleJson = JSON.stringify({
      dynamodb: {
        OldImage: {
          State: {
            S: ["Ready"],
          },
        },
        NewImage: {
          State: {
            S: ["Ongoing"],
          },
        },
      },
    });

    // Filter rule for game state changes (Ongoing -> Ready)
    const gameCompletedFilterRuleJson = JSON.stringify({
      dynamodb: {
        OldImage: {
          State: {
            S: ["Ongoing"],
          },
        },
        NewImage: {
          State: {
            S: ["Ready"],
          },
        },
      },
    });

    // Create pipe for game state changes to trigger Step Functions
    const gameStateDbToObserverSfn = new pipes.CfnPipe(
      this,
      "gameStateDbToObserverSfn",
      {
        roleArn: pipeRole.roleArn,
        source: props.gameStateTable.tableStreamArn!,
        target: props.sfnStateMachine.stateMachineArn!,
        sourceParameters: {
          dynamoDbStreamParameters: {
            startingPosition: "LATEST",
            batchSize: 1,
            maximumRetryAttempts: 3,
            onPartialBatchItemFailure: "AUTOMATIC_BISECT",
          },
          filterCriteria: {
            filters: [
              {
                pattern: filterRuleJson,
              },
            ],
          },
        },
        targetParameters: {
          stepFunctionStateMachineParameters: {
            invocationType: "FIRE_AND_FORGET",
          },
        },
      },
    );

    // Create pipe for game state changes to SNS topic
    const gameStateDbToSns = new pipes.CfnPipe(this, "gameStateDbToSns", {
      roleArn: pipeRole.roleArn,
      source: props.gameStateTable.tableStreamArn!,
      target: gameStateChangeTopic.topicArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          startingPosition: "LATEST",
          batchSize: 1,
          maximumRetryAttempts: 3,
          onPartialBatchItemFailure: "AUTOMATIC_BISECT",
        },
        // フィルターを削除
      },
    });

    // Create pipe for security scenario changes to SNS
    const securityScenarioDbToSns = new pipes.CfnPipe(
      this,
      "securityScenarioDbToSns",
      {
        roleArn: pipeRole.roleArn,
        source: props.securityScenarioTable.tableStreamArn!,
        target: securityScenarioTopic.topicArn,
        sourceParameters: {
          dynamoDbStreamParameters: {
            startingPosition: "LATEST",
            batchSize: 1,
            maximumRetryAttempts: 3,
            onPartialBatchItemFailure: "AUTOMATIC_BISECT",
          },
        },
      },
    );

    // Create pipe for resilience scenario changes to SNS
    const resilienceScenarioDbToSns = new pipes.CfnPipe(
      this,
      "resilienceScenarioDbToSns",
      {
        roleArn: pipeRole.roleArn,
        source: props.resilienceScenarioTable.tableStreamArn!,
        target: resilienceScenarioTopic.topicArn,
        sourceParameters: {
          dynamoDbStreamParameters: {
            startingPosition: "LATEST",
            batchSize: 1,
            maximumRetryAttempts: 3,
            onPartialBatchItemFailure: "AUTOMATIC_BISECT",
          },
        },
      },
    );

    // Add dependencies
    securityScenarioDbToSns.node.addDependency(pipeRole);
    resilienceScenarioDbToSns.node.addDependency(pipeRole);
    gameStateDbToObserverSfn.node.addDependency(pipeRole);
    gameStateDbToSns.node.addDependency(pipeRole);
  }
}
