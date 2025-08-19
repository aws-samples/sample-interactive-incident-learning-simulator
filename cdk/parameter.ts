import * as cdk from "aws-cdk-lib";
import { StackInput, stackInputSchema } from "./lib/stack-input";

const getContext = (app: cdk.App): StackInput => {
  const context = app.node.getAllContext();
  return stackInputSchema.parse(context);
};

export const getParams = (app: cdk.App): StackInput => {
  const params = getContext(app);
  return params;
};
