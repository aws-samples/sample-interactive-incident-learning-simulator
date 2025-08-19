import * as lambda from "aws-lambda";

export const handler: lambda.APIGatewayRequestAuthorizerHandler = async (
  event: lambda.APIGatewayRequestAuthorizerEvent,
): Promise<lambda.APIGatewayAuthorizerResult> => {
  console.log(event);

  try {
    // Authrization ヘッダーの確認
    const authorizationHeader = event.headers?.Authorization;
    if (authorizationHeader === process.env.APIKEY) {
      return allowPolicy(event);
    } else {
      return denyAllPolicy();
    }
  } catch (error) {
    console.log(error);
    return denyAllPolicy();
  }
};

const allowPolicy = (
  event: lambda.APIGatewayRequestAuthorizerEvent,
): lambda.APIGatewayAuthorizerResult => {
  return {
    principalId: "userid",
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: "Allow",
          Resource: event.methodArn,
        },
      ],
    },
  };
};

const denyAllPolicy = (): lambda.APIGatewayAuthorizerResult => {
  return {
    principalId: "*",
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "*",
          Effect: "Deny",
          Resource: "*",
        },
      ],
    },
  };
};
