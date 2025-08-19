import * as cdk from "aws-cdk-lib";
import { IConstruct } from "constructs";
import { SimulatorStack } from "./simulator-stack";
import { StackInput } from "./stack-input";

class DeletionPolicySetter implements cdk.IAspect {
  constructor(private readonly policy: cdk.RemovalPolicy) {}

  public visit(node: IConstruct): void {
    if (node instanceof cdk.CfnResource) {
      node.applyRemovalPolicy(this.policy);
    }
  }
}

export const createStacks = (app: cdk.App, params: StackInput) => {
  const stacks = [];
  stacks.push(
    new SimulatorStack(app, "SimulatorStack", {
      params: params,
    }),
  );

  // もし追加の Stack が発生した場合は上記のように追加していくことで、RemovalPolicy を動的に設定できる

  stacks.map((stack) => {
    cdk.Aspects.of(stack).add(
      new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY),
    );
  });

  return {
    ...stacks,
  };
};
