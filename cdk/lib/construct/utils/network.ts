import { CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import {
  CfnEIP,
  FlowLogDestination,
  FlowLogTrafficType,
  SubnetType,
  Vpc,
  VpcProps,
  IpAddresses,
  CfnNatGateway,
  NatProvider,
} from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { EncryptionKey } from "./key";
import { Construct } from "constructs";
import { isEmpty } from "lodash";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";

export class Network extends Construct {
  public readonly vpc: Vpc;
  public readonly eip: CfnEIP;

  constructor(
    scope: Construct,
    id: string,
    props: {
      maxAzs: number;
      cidr: string;
      cidrMask: number;
      publicSubnet?: boolean;
      isolatedSubnet?: boolean;
      natSubnet?: boolean;
    },
  ) {
    super(scope, id);

    // Vpc logging - 60 days
    const cwLogs = new LogGroup(this, `${id}VpcLogs`, {
      logGroupName: `/vpc/${id}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.TWO_MONTHS,
      encryptionKey: new EncryptionKey(this, `${id}CWLogsEncryptionKey`, {
        servicePrincipals: [new ServicePrincipal("logs.amazonaws.com")],
      }).encryptionKey,
    });

    const subnetConfiguration: VpcProps["subnetConfiguration"] = [];

    if (props.publicSubnet) {
      subnetConfiguration.push({
        cidrMask: props.cidrMask,
        name: `${id.toLowerCase()}-public-subnet`,
        subnetType: SubnetType.PUBLIC,
      });
    }

    if (props.natSubnet) {
      this.eip = new CfnEIP(this, "EIP");
      subnetConfiguration.push({
        cidrMask: props.cidrMask,
        name: `${id.toLowerCase()}-private-subnet`,
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      });
    }

    if (props.isolatedSubnet) {
      subnetConfiguration.push({
        cidrMask: props.cidrMask,
        name: `${id.toLowerCase()}-isolated-subnet`,
        subnetType: SubnetType.PRIVATE_ISOLATED,
      });
    }

    if (isEmpty(subnetConfiguration)) {
      throw new Error("No subnet configuration enabled");
    }

    // Create VPC - Private and public subnets
    this.vpc = new Vpc(this, `Vpc`, {
      ipAddresses: IpAddresses.cidr(props.cidr),
      subnetConfiguration,
      maxAzs: props.maxAzs,
      natGateways: props.natSubnet ? 1 : undefined,
      natGatewayProvider:
        props.natSubnet && this.eip
          ? NatProvider.gateway({
              eipAllocationIds: [this.eip.attrAllocationId],
            })
          : undefined,
      flowLogs: {
        s3: {
          destination: FlowLogDestination.toCloudWatchLogs(cwLogs),
          trafficType: FlowLogTrafficType.ALL,
        },
      },
    });

    new CfnOutput(this, "VpcId", {
      exportName: `${id}VpcId`,
      value: this.vpc.vpcId,
    });
  }
}
