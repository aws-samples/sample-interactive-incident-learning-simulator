import { Context } from "aws-lambda";
import * as AWS from "aws-sdk";

// AWS SDKクライアントの初期化
const ec2 = new AWS.EC2();
const iam = new AWS.IAM();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

interface SfnParallelEvent {
  gameId: string;
}

/**
 * EC2インスタンスに関連付けられたIAMロールがあ安全なロール名かどうかを判定する
 * @param instanceIds EC2インスタンスIDの配列
 * @param safeRoleName 安全なロールの名前
 * @returns 少なくとも一つのインスタンスでSafeRoleが使用されている場合はtrue、そうでない場合はfalse
 */
async function checkEc2Roles(
  instanceIds: string[],
  safeRoleName: string,
): Promise<boolean> {
  try {
    // インスタンスの詳細情報を取得
    const describeParams = {
      InstanceIds: instanceIds,
    };

    const response = await ec2.describeInstances(describeParams).promise();

    if (!response.Reservations || response.Reservations.length === 0) {
      console.error("No EC2 instances found");
      return false;
    }
    console.log("hoge");

    // 各インスタンスのIAMロールをチェック
    let checkResult = true;
    for (const reservation of response.Reservations) {
      for (const instance of reservation.Instances || []) {
        if (instance.IamInstanceProfile && instance.IamInstanceProfile.Arn) {
          // IAMインスタンスプロファイルのARNからロール名を抽出
          const profileArn = instance.IamInstanceProfile.Arn;
          const profileName = profileArn.split("/").pop();

          if (!profileName) {
            console.error(
              `Could not extract profile name from ARN: ${profileArn}`,
            );
            continue;
          }

          // インスタンスプロファイルからロール情報を取得
          const profileParams = {
            InstanceProfileName: profileName,
          };

          const profileResponse = await iam
            .getInstanceProfile(profileParams)
            .promise();

          // ロール名をチェック。いずれかのロールがSafeRoleでなければfalseを返す
          for (const role of profileResponse.InstanceProfile.Roles || []) {
            console.log(role.RoleName, safeRoleName);
            if (role.RoleName != safeRoleName) {
              console.log(`Instance ${instance.InstanceId} does not have SafeRole`);
              checkResult = false;
            }
          }
        }
      }
    }

    return checkResult;
  } catch (error) {
    console.error(`Error checking EC2 roles: ${error}`);
    throw error;
  }
}

/**
 * DynamoDBのテーブルを更新する
 * @param componentName コンポーネント名
 * @param currentState 現在の状態 ('Green' or 'Red')
 */
async function updateDynamoDBState(
  componentName: string,
  currentState: "Green" | "Red",
): Promise<void> {
  try {
    const securityScenarioTableName =
      process.env.SECURITY_SCENARIO_TABLE_NAME || "SecurityScenarioTable";

    const params = {
      TableName: securityScenarioTableName,
      Key: {
        ComponentName: componentName,
      },
      UpdateExpression: "set CurrentState = :state",
      ExpressionAttributeValues: {
        ":state": currentState,
      },
    };

    await dynamoDB.update(params).promise();
    console.log(`Updated ${componentName} state to ${currentState}`);
  } catch (error) {
    console.error(`Error updating DynamoDB: ${error}`);
    throw error;
  }
}

/**
 * リソースマッピングテーブルからEC2インスタンスIDを取得する
 * @returns EC2インスタンスIDの配列
 */
async function getEc2InstanceIds(): Promise<string[]> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";
    const instanceIds: string[] = [];

    // EC2_INSTANCE_1を取得
    const params1 = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "EC2_INSTANCE_1",
      },
    };

    const result1 = await dynamoDB.get(params1).promise();
    if (result1.Item && result1.Item.ResourceId) {
      instanceIds.push(result1.Item.ResourceId);
    }

    // EC2_INSTANCE_2を取得
    const params2 = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "EC2_INSTANCE_2",
      },
    };

    const result2 = await dynamoDB.get(params2).promise();
    if (result2.Item && result2.Item.ResourceId) {
      instanceIds.push(result2.Item.ResourceId);
    }

    if (instanceIds.length === 0) {
      throw new Error("EC2 instance IDs not found in resource mapping table");
    }

    console.log(`Retrieved EC2 instance IDs: ${instanceIds.join(", ")}`);
    return instanceIds;
  } catch (error) {
    console.error(`Error getting EC2 instance IDs: ${error}`);
    throw error;
  }
}

async function getSafeRoleName(): Promise<string> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const params = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "EC2_SAFE_ROLE",
      },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item || !result.Item.ResourceId) {
      throw new Error("unsafe role not found in resource mapping table");
    }

    // DynamoDBには実際にはインスタンスプロファイル名が格納されているため、
    // そのプロファイルからロール名を取得する
    const profileName = result.Item.ResourceName;

    try {
      // インスタンスプロファイルからロール情報を取得
      const profileParams = {
        InstanceProfileName: profileName,
      };

      const profileResponse = await iam
        .getInstanceProfile(profileParams)
        .promise();

      // プロファイルに関連付けられた最初のロール名を返す
      if (
        profileResponse.InstanceProfile.Roles &&
        profileResponse.InstanceProfile.Roles.length > 0
      ) {
        return profileResponse.InstanceProfile.Roles[0].RoleName;
      } else {
        throw new Error(`No roles found in instance profile: ${profileName}`);
      }
    } catch (profileError) {
      console.error(
        `Error getting role from instance profile: ${profileError}`,
      );
      throw profileError;
    }
  } catch (error) {
    console.error(`Error getting safe role name: ${error}`);
    throw error;
  }
}

export const handler = async (event: SfnParallelEvent, context: Context) => {
  try {
    console.log("Checking EC2 roles for unsafe configuration...");

    // リソースマッピングテーブルからEC2インスタンスIDを取得
    const instanceIds = await getEc2InstanceIds();

    const safeRoleName = await getSafeRoleName();

    // EC2インスタンスのロールをチェック
    const hasSafeRole = await checkEc2Roles(instanceIds, safeRoleName);

    // DynamoDBを更新
    const currentState = hasSafeRole ? "Green" : "Red";
    await updateDynamoDBState("EC2 Role", currentState);

    // レスポンスを返す
    const response = {
      solved: currentState === "Green",
    };

    return response;
  } catch (error) {
    console.error(`Error in handler: ${error}`);
    throw error;
  }
};
