#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { getParams } from "../parameter";
import { createStacks } from "../lib/create-stacks";
import { AwsSolutionsChecks } from "cdk-nag";

const app = new cdk.App();
const params = getParams(app);
params.env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};
createStacks(app, params);
cdk.Aspects.of(app).add(new AwsSolutionsChecks());
