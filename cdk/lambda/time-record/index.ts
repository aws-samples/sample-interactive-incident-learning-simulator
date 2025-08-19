import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  PutCommand,
  QueryCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

const dynamoDB = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoDB);

const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event: {
  path: any;
  httpMethod: any;
  body: string;
  queryStringParameters: { mode: any };
}) => {
  // Event 出力
  console.log(event);
  try {
    const path = event.path;
    const method = event.httpMethod;

    // タイマー記録エンドポイント
    if (path === "/record-ranking" && method === "POST") {
      const requestBody = JSON.parse(event.body);
      const { time, timer, mode, pattern } = requestBody;
      console.log(requestBody);

      const input = {
        time: String(time),
        timer: timer,
        patternMode: `${pattern}#${mode}`,
      };

      const command = new PutCommand({ TableName: TABLE_NAME, Item: input });
      const response = await docClient.send(command);
      console.log(response);

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
        },
        body: JSON.stringify({ message: "タイマー記録が保存されました" }),
      };
    }

    // トップタイマー取得エンドポイント
    if (path === "/get-rankings" && method === "GET") {
      const easy_sec_command = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "patternMode",
        KeyConditionExpression: "#p = :patternModeValue",
        ExpressionAttributeNames: {
          "#p": "patternMode",
        },
        ExpressionAttributeValues: {
          ":patternModeValue": "Security#Easy",
        },
        Limit: 3,
      });

      const hard_sec_command = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "patternMode",
        KeyConditionExpression: "#p = :patternModeValue",
        ExpressionAttributeNames: {
          "#p": "patternMode",
        },
        ExpressionAttributeValues: {
          ":patternModeValue": "Security#Hard",
        },
        Limit: 3,
      });

      const easy_res_command = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "patternMode",
        KeyConditionExpression: "#p = :patternModeValue",
        ExpressionAttributeNames: {
          "#p": "patternMode",
        },
        ExpressionAttributeValues: {
          ":patternModeValue": "Resiliency#Easy",
        },
        Limit: 3,
      });

      const hard_res_command = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "patternMode",
        KeyConditionExpression: "#p = :patternModeValue",
        ExpressionAttributeNames: {
          "#p": "patternMode",
        },
        ExpressionAttributeValues: {
          ":patternModeValue": "Resiliency#Hard",
        },
        Limit: 3,
      });

      const mode = event.queryStringParameters.mode;
      if (mode === "security") {
        const easy_sec_response = await docClient.send(easy_sec_command);
        const hard_sec_response = await docClient.send(hard_sec_command);
        const response = {
          Easy: easy_sec_response.Items,
          Hard: hard_sec_response.Items,
        };
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
          },
          body: JSON.stringify(response),
        };
      } else if (mode === "resiliency") {
        const easy_res_response = await docClient.send(easy_res_command);
        const hard_res_response = await docClient.send(hard_res_command);
        const response = {
          Easy: easy_res_response.Items,
          Hard: hard_res_response.Items,
        };
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
          },
          body: JSON.stringify(response),
        };
      }
    }

    return {
      statusCode: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
      },
      body: JSON.stringify({ message: "リソースが見つかりません" }),
    };
  } catch (error) {
    console.error("エラー:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
      },
      body: JSON.stringify({ message: "内部サーバーエラー" }),
    };
  }
};
