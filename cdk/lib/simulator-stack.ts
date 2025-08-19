import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { StackInput } from "./stack-input";
import { DemoApp } from "./construct/demoapp/demo-app";
import { Observation } from "./construct/observation";
import { Api } from "./construct/api";
import { Database } from "./construct/database";
import { Events } from "./construct/events";
import { FailureInjection } from "./construct/failure-injection";
import { Web } from "./construct/web";
import { DetectIncidents } from "./construct/detect-incidents";
import { TimeRecord } from "./construct/time-record";
import { Bucket } from "./construct/utils/bucket";
import { NagSuppressions } from "cdk-nag";

export interface SimulatorStackProps extends cdk.StackProps {
  params: StackInput;
}

export class SimulatorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SimulatorStackProps) {
    super(scope, id, {
      env: props.params.env,
    });

    // CloudTrail
    const trailLogBucket = new Bucket(this, "TrailLogBucket");
    const cloudtrail = new cdk.aws_cloudtrail.Trail(this, "Trail", {
      trailName: "InteractiveIncidentLearningSimulatorDoNotDisable",
      bucket: trailLogBucket.bucket,
    });

    //デモアプリ
    const demoApp = new DemoApp(this, "DemoApp");

    const database = new Database(this, "Database", {});
    // InitData の Lambda を cloudtrail, demoapp のプロビジョニングが完了した後に実行させる
    database.node.addDependency(trailLogBucket)
    database.node.addDependency(cloudtrail);
    database.node.addDependency(demoApp);

    //障害監視
    const observation = new Observation(this, "Observation", {
      gameStateTable: database.gameStateTable,
      resourceMappingTable: database.resourceMappingTable,
      securityScenarioTable: database.securityScenarioTable,
      resilienceScenarioTable: database.resilienceScenarioTable,
      loadBalancerDnsName: demoApp.loadBalancerDnsName,
      ec2Instances: demoApp.ec2Instances,
      unsafeInstanceProfileArn: demoApp.unsafeInstanceProfileArn,
      databaseCluster: demoApp.databaseCluster,
      trail: cloudtrail,
      trailLogBucket: trailLogBucket.bucket,
    });

    //障害発生機能
    const failureInjection = new FailureInjection(this, "FailureInjection", {
      gameStateTable: database.gameStateTable,
      securityScenarioTable: database.securityScenarioTable,
      resilienceScenarioTable: database.resilienceScenarioTable,
      resourceMappingTable: database.resourceMappingTable,
      ec2Instances: demoApp.ec2Instances,
      trail: cloudtrail,
      trailLogBucket: trailLogBucket.bucket,
      albSecurityGroup: demoApp.albSecurityGroup,
      ec2SecurityGroup: demoApp.ec2SecurityGroup,
      auroraSecurityGroup: demoApp.auroraSecurityGroup,
      observationStateMachine: observation.stateMachine,
    });

    //Apigateway + それに付随する障害発生lambda想定
    const injectIncident = new Api(this, "Api", {
      resilienceEasyFunction: failureInjection.resilienceEasyFunction,
      resilienceHardFunction: failureInjection.resilienceHardFunction,
      securityEasyFunction: failureInjection.securityEasyFunction,
      securityHardFunction: failureInjection.securityHardFunction,
      resetFunction: failureInjection.resetFunction,
    });

    const events = new Events(this, "Events", {
      gameStateTable: database.gameStateTable,
      sfnStateMachine: observation.stateMachine,
      securityScenarioTable: database.securityScenarioTable,
      resilienceScenarioTable: database.resilienceScenarioTable,
    });

    // 時間記録するための APIGW + Lambda + DynamoDB
    const timeRecord = new TimeRecord(this, "TimeRecord");

    // 障害情報を検知するための AppSync + Lambda
    const detectIncidents = new DetectIncidents(
      this,
      "DetectInsident",
      events.topicList,
    );

    // Web Frontend Application
    const web = new Web(this, "Web", {
      // API Gateway
      recordAPIGWEndpointUrl: timeRecord.recordAPIGWEndpointUrl,
      recordAPIGWAPIKey: timeRecord.recordAPIGWAPIKey,
      incidentAPIGWEndpointUrl: injectIncident.api.url,
      incidentAPIGWAPIKey: injectIncident.apiKeyAuth.apikeyString,

      // AppSync
      appsyncAPIEndpointURL: detectIncidents.api.graphqlUrl,
      appsyncAPIKey: detectIncidents.api.apiKey!, // DetectIncidents 側で APIKEYを設定しているので、! でOK
      appsyncAPIArn: detectIncidents.api.arn,
    });

    // CDK NAG 対応
    const nodejsBuildCustomResourceHandler = this.node.children.filter((node) =>
      node.node.id.startsWith("NodejsBuildCustomResourceHandler"),
    )[0].node.id;

    const customDeployment = this.node.children.filter((node) =>
      node.node.id.startsWith("Custom::CDKBucketDeployment"),
    )[0].node.id;

    // NodejsBuild ライブラリにおける CDK NAG Suppression
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${cdk.Stack.of(this).stackName}/${nodejsBuildCustomResourceHandler}/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "This application is for casual gaming enjoyment. Since user management is not anticipated, Cognito authentication is not required.",
        },
      ],
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${cdk.Stack.of(this).stackName}/${nodejsBuildCustomResourceHandler}/Resource`,
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "This application is for casual gaming enjoyment and this is a temporary environment. We use deploy-time-build library and this lambda is created by library.",
        },
      ],
    );

    // CDK Deployment Bucket ライブラリにおける CDK NAG Suppression
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${cdk.Stack.of(this).stackName}/${customDeployment}/Resource`,
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "This application is for casual gaming enjoyment and this is a temporary environment. This Custom Resource is created by BucketDeployment and we are unable to modify this resource.",
        },
      ],
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${cdk.Stack.of(this).stackName}/${customDeployment}/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "This application is for casual gaming enjoyment and this is a temporary environment. This Custom Resource is created by BucketDeployment. We are unable to modify this resource. https://github.com/aws/aws-cdk/issues/27210",
        },
      ],
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${cdk.Stack.of(this).stackName}/${customDeployment}/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "This application is for casual gaming enjoyment and this is a temporary environment. This Custom Resource is created by BucketDeployment and we are unable to modify this resource.",
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "This application is for casual gaming enjoyment and this is a temporary environment. This Custom Resource is created by BucketDeployment and we are unable to modify this resource. https://github.com/aws/aws-cdk/issues/27210",
        },
      ],
    );

    // Cfn Outputs
    new cdk.CfnOutput(this, "Region", {
      value: this.region,
    });

    new cdk.CfnOutput(this, "WebUrl", {
      value: `https://${web.distribution.domainName}`,
    });
  }
}
