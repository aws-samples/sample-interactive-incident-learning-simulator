import {
  aws_ec2,
  aws_iam,
  aws_elasticloadbalancingv2,
  aws_s3_assets,
  aws_cloudwatch as cloudwatch,
  aws_synthetics as synthetics,
  Duration,
  CfnOutput,
  aws_applicationsignals as applicationsignals,
  Stack,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { NagSuppressions } from "cdk-nag";
import { Bucket } from "../utils/bucket";

export class Ec2AppInstance extends Construct {
  public readonly ec2Instances: aws_ec2.Instance[];
  public readonly unsafeInstanceProfileArn: string;
  public readonly httpTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  public readonly alb: aws_elasticloadbalancingv2.ApplicationLoadBalancer;
  public readonly albSg: aws_ec2.SecurityGroup;
  public readonly ec2Sg: aws_ec2.SecurityGroup;
  public readonly auroraSg: aws_ec2.ISecurityGroup;

  constructor(
    scope: Construct,
    id: string,
    props: {
      vpc: aws_ec2.IVpc;
      auroraSecretName: string;
      auroraSecurityGroupId: string;
      auroraSecretEncryptionKeyArn: string;
    },
  ) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    // Turn on Application Signals
    new applicationsignals.CfnDiscovery(this, "ApplicationSignalsServiceRole");

    // Security Group for EC2 instances
    const sgForEc2 = new aws_ec2.SecurityGroup(this, "Ec2SecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: "Security group for EC2 instances running Java application",
    });

    // Security Group for ALB
    const sgForAlb = new aws_ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: true,
    });
    this.albSg = sgForAlb;
    this.ec2Sg = sgForEc2;
    sgForAlb.addIngressRule(aws_ec2.Peer.anyIpv4(), aws_ec2.Port.tcp(80));

    // Allow traffic from ALB to EC2 instances on port 8080
    sgForEc2.addIngressRule(sgForAlb, aws_ec2.Port.tcp(8080));

    // Allow traffic from EC2 to Aurora
    const sgForAurora = aws_ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "AuroraSecurityGroup",
      props.auroraSecurityGroupId,
    );
    this.auroraSg = sgForAurora;
    sgForEc2.addEgressRule(sgForAurora, aws_ec2.Port.tcp(5432));

    // Allow traffic from EC2 security group to Aurora security group
    sgForAurora.connections.allowFrom(
      sgForEc2,
      aws_ec2.Port.tcp(5432),
      "Allow traffic from EC2 to Aurora",
    );

    // Create IAM role for EC2 instances
    const ec2SafeRole = new aws_iam.Role(this, "Ec2SafeRole", {
      assumedBy: new aws_iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "CloudWatchAgentServerPolicy",
        ),
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AWSXRayDaemonWriteAccess",
        ),
      ],
    });
    const safeInstanceProfile = new aws_iam.InstanceProfile(
      this,
      "Ec2SafeInstanceProfile",
      {
        role: ec2SafeRole,
      },
    );

    // Create Dummy IAM role for EC2 instances
    const ec2UnsafeRole = new aws_iam.Role(this, "Ec2UnsafeRole", {
      assumedBy: new aws_iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
      ],
    });
    const unsafeInstanceProfile = new aws_iam.InstanceProfile(
      this,
      "Ec2UnsafeInstanceProfile",
      {
        role: ec2UnsafeRole,
      },
    );
    this.unsafeInstanceProfileArn = unsafeInstanceProfile.instanceProfileArn;

    // Add Application Signals permissions as inline policy
    ec2SafeRole.addToPolicy(
      new aws_iam.PolicyStatement({
        actions: [
          // Application Signals
          "application-signals:*",

          // CloudWatch メトリクス
          "cloudwatch:PutMetricData",
          "cloudwatch:GetMetricData",
          "cloudwatch:ListMetrics",
          "cloudwatch:GetMetricStatistics",

          // CloudWatch Logs
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:StartQuery",
          "logs:GetQueryResults",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",

          // X-Ray
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetServiceGraph",
          "xray:BatchGetTraces",
          "xray:GetTraceSummaries",
        ],
        resources: ["*"],
      }),
    );

    // Add permission to access Aurora secret
    ec2SafeRole.addToPolicy(
      new aws_iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${region}:${account}:secret:${props.auroraSecretName}*`,
        ],
      }),
    );
    ec2SafeRole.addToPolicy(
      new aws_iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [props.auroraSecretEncryptionKeyArn],
      }),
    );

    // Upload application source code to S3
    const appAsset = new aws_s3_assets.Asset(this, "AppSourceAsset", {
      path: path.join(__dirname, "../../../demoapp"),
    });

    // Load user data script from external file
    const userDataScriptPath = path.join(__dirname, "scripts/ec2-userdata.sh");
    let userDataScript = fs.readFileSync(userDataScriptPath, "utf8");

    // Replace variables in the script
    userDataScript = userDataScript
      .replace("${APP_ASSET_S3_URL}", appAsset.s3ObjectUrl)
      .replace("${AURORA_SECRET_NAME}", props.auroraSecretName)
      .replace("${AWS_REGION}", region);

    // Create user data for EC2 instances
    const userData = aws_ec2.UserData.forLinux();
    userData.addCommands(userDataScript);

    // Create EC2 instances
    this.ec2Instances = [];

    // Create 2 EC2 instances in different AZs
    const availabilityZones = props.vpc.availabilityZones.slice(0, 2); // Get first 2 AZs

    for (let i = 0; i < 2; i++) {
      const instance = new aws_ec2.Instance(
        this,
        `EC2Instance${randomUUID().slice(0, 8)}`,
        {
          vpc: props.vpc,
          instanceType: aws_ec2.InstanceType.of(
            aws_ec2.InstanceClass.M8G,
            aws_ec2.InstanceSize.XLARGE,
          ),
          machineImage: aws_ec2.MachineImage.latestAmazonLinux2023({
            cpuType: aws_ec2.AmazonLinuxCpuType.ARM_64,
          }),
          userData: userData,
          instanceProfile: safeInstanceProfile,
          securityGroup: sgForEc2,
          vpcSubnets: {
            subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
            availabilityZones: [availabilityZones[i]],
          },
          blockDevices: [
            {
              deviceName: "/dev/xvda",
              volume: aws_ec2.BlockDeviceVolume.ebs(20, {
                encrypted: true,
              }),
            },
          ],
        },
      );

      // Grant permissions to download the application source code
      appAsset.grantRead(instance.role);

      this.ec2Instances.push(instance);
    }

    // Create ALB
    this.alb = new aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      "Alb",
      {
        vpc: props.vpc,
        internetFacing: true,
        securityGroup: sgForAlb,
        vpcSubnets: props.vpc.selectSubnets({
          subnetType: aws_ec2.SubnetType.PUBLIC,
        }),
        dropInvalidHeaderFields: true,
      },
    );

    const albAccessLogBucket = new Bucket(this, "ALBAccessLogBucket");
    this.alb.logAccessLogs(albAccessLogBucket.bucket);

    // Create Target Group
    this.httpTargetGroup =
      new aws_elasticloadbalancingv2.ApplicationTargetGroup(
        this,
        "HttpTarget",
        {
          vpc: props.vpc,
          port: 8080,
          protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
          targetType: aws_elasticloadbalancingv2.TargetType.INSTANCE,
          healthCheck: {
            path: "/actuator/health",
            port: "8080",
            healthyHttpCodes: "200-299",
            interval: Duration.seconds(60),
            timeout: Duration.seconds(30),
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 5,
          },
        },
      );

    // Register instances with target group using lower level CfnTargetGroup
    const cfnTargetGroup = this.httpTargetGroup.node
      .defaultChild as aws_elasticloadbalancingv2.CfnTargetGroup;
    cfnTargetGroup.addPropertyOverride(
      "Targets",
      this.ec2Instances.map((instance) => ({
        Id: instance.instanceId,
        Port: 8080,
      })),
    );

    // Add listener to ALB
    this.alb.addListener("WebappHttpListener", {
      port: 80,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
      open: false,
      defaultTargetGroups: [this.httpTargetGroup],
    });

    // Create Synthetics Canary
    const artifactsBucket = new Bucket(this, "TodoAppCanaryArtifactsBucket");
    const canary = new synthetics.Canary(this, "TodoAppCanary", {
      schedule: synthetics.Schedule.rate(Duration.minutes(1)),
      test: synthetics.Test.custom({
        code: synthetics.Code.fromInline(`
          const synthetics = require('Synthetics');
          const log = require('SyntheticsLogger');

          const pageLoadBlueprint = async function () {
            const url = '${this.alb.loadBalancerDnsName}';
            
            // Test the main page load
            const page = await synthetics.getPage();
            const response = await page.goto('http://' + url, {waitUntil: 'domcontentloaded'});
            if (!response) {
              throw 'Failed to load page';
            }
            return response;
          };

          exports.handler = async () => {
            return await pageLoadBlueprint();
          };
        `),
        handler: "index.handler",
      }),
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_8_0,
      environmentVariables: {
        NODE_TLS_REJECT_UNAUTHORIZED: "0", // Required for HTTP endpoints
      },
      artifactsBucketLocation: {
        bucket: artifactsBucket.bucket,
      },
    });

    // Add canary metrics to CloudWatch dashboard
    const canaryMetric = canary.metricSuccessPercent({
      period: Duration.minutes(1),
    });

    new cloudwatch.Alarm(this, "CanaryAlarm", {
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      metric: canaryMetric,
      threshold: 90,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: "Alarm when Canary success rate drops below 90%",
    });

    // Output ALB DNS name
    new CfnOutput(this, "AlbDnsName", {
      value: this.alb.loadBalancerDnsName,
      description: "The DNS name of the load balancer",
    });

    /**
     * CDK-NAG Suppressions
     */
    NagSuppressions.addResourceSuppressions(ec2SafeRole, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "This resource will be deleted after chaos engineering. And managed policies keep this role simple.",
      },
    ]);
    NagSuppressions.addResourceSuppressions(ec2UnsafeRole, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "This resource will be deleted after chaos engineering. It should be dangerous to simulate security incident.",
      },
    ]);

    this.ec2Instances.map((instance) => {
      NagSuppressions.addResourceSuppressions(instance, [
        {
          id: "AwsSolutions-EC28",
          reason:
            "This resource will be deleted after chaos engineering. No need to turn on detailed monitoring.",
        },
        {
          id: "AwsSolutions-EC29",
          reason:
            "This resource will be deleted after chaos engineering. It should not turn on termination protection.",
        },
      ]);
    });

    NagSuppressions.addResourceSuppressions(this.albSg, [
      {
        id: "AwsSolutions-EC23",
        reason: "This is demo application. It requires access from anywhere.",
      },
    ]);

    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      `${ec2SafeRole.node.path}/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "CloudWatch, Logs, X-Ray, credential, and S3 need to set * resources to access",
        },
      ],
    );

    NagSuppressions.addResourceSuppressions(canary.role, [
      {
        id: "AwsSolutions-IAM4",
        reason: "Managed policies keep this role simple.",
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "CloudWatch Logs and S3 need to set * resources to access.",
      },
    ]);
  }
}
