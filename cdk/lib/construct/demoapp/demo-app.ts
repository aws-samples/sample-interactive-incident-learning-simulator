import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  DatabaseClusterEngine,
  AuroraPostgresEngineVersion,
} from "aws-cdk-lib/aws-rds";
import { Network } from "../utils/network";
import { Aurora } from "./aurora";
import { Ec2AppInstance } from "./ec2-app-instance";

export class DemoApp extends Construct {
  public readonly loadBalancerDnsName: string;
  public readonly ec2Instances: cdk.aws_ec2.Instance[];
  public readonly unsafeInstanceProfileArn: string;
  public readonly databaseCluster: cdk.aws_rds.DatabaseCluster;
  public readonly albSecurityGroup: cdk.aws_ec2.SecurityGroup;
  public readonly ec2SecurityGroup: cdk.aws_ec2.SecurityGroup;
  public readonly auroraSecurityGroup: cdk.aws_ec2.ISecurityGroup;
  constructor(
    scope: Construct,
    id: string,
  ) {
    super(scope, id);

    // Create networking resources
    const network = new Network(this, `AppVpc`, {
      cidr: "10.0.0.0/16",
      cidrMask: 24,
      publicSubnet: true,
      natSubnet: true,
      isolatedSubnet: true,
      maxAzs: 2,
    });

    // Create Aurora
    const aurora = new Aurora(this, "Aurora", {
      enabledProxy: false, // If you want to use Lambda Proxy, This parameter is true. And If you want to use `serverless-webapp`, Please set `true`.
      auroraEdition: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_16_6,
      }),
      vpc: network.vpc,
      dbUserName: "postgres",
    });
    this.databaseCluster = aurora.aurora;

    // Create EC2 instances
    const ec2App = new Ec2AppInstance(this, `WebappEc2`, {
      vpc: network.vpc,
      auroraSecretName: aurora.databaseCredentials.secretName!,
      auroraSecurityGroupId:
        aurora.aurora.connections.securityGroups[0].securityGroupId,
      auroraSecretEncryptionKeyArn:
        aurora.databaseCredentials.encryptionKey!.keyArn,
    });
    this.unsafeInstanceProfileArn = ec2App.unsafeInstanceProfileArn;
    this.ec2Instances = ec2App.ec2Instances;
    this.albSecurityGroup = ec2App.albSg;
    this.ec2SecurityGroup = ec2App.ec2Sg;
    this.auroraSecurityGroup = ec2App.auroraSg;

    // Output ALB DNS name
    new cdk.CfnOutput(this, "AlbDnsName", {
      value: ec2App.alb.loadBalancerDnsName,
      description: "The DNS name of the load balancer",
    });
    this.loadBalancerDnsName = ec2App.alb.loadBalancerDnsName;
  }
}
