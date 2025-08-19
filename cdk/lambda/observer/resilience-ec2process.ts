import { Context } from "aws-lambda";
import * as AWS from "aws-sdk";
import axios from "axios";

// AWS SDKクライアントの初期化
const ec2 = new AWS.EC2();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

interface SfnParallelEvent {
  gameId: string;
}

/**
 * LOADBALANCER_DNS_NAMEに対するHTTPリクエストを送信して200が返るかチェック
 * @returns HTTPリクエストが200を返す場合はtrue、そうでない場合はfalse
 */
async function checkLoadBalancerHealth(): Promise<boolean> {
  try {
    const response = await axios.get(
      "http://" + process.env.LOADBALANCER_DNS_NAME,
      { timeout: 2000 },
    ); // 2秒タイムアウト
    console.log(`Load balancer health check status: ${response.status}`);
    return response.status === 200;
  } catch (error) {
    console.error("Load balancer health check failed:", error);
    return false;
  }
}

/**
 * ALBに付与されているセキュリティグループがインバウンドに0.0.0.0/0からHTTPの通信許可が設定されているかを判定する
 * @param securityGroupId セキュリティグループID
 * @returns 0.0.0.0/0からのHTTP通信が許可されていない場合はtrue（異常）、許可されている場合はfalse（正常）
 */
async function checkAlbSecurityGroupDirect(
  securityGroupId: string,
): Promise<boolean> {
  try {
    const params = {
      GroupIds: [securityGroupId],
    };

    const response = await ec2.describeSecurityGroups(params).promise();

    if (!response.SecurityGroups || response.SecurityGroups.length === 0) {
      console.error(`Security group ${securityGroupId} not found`);
      return true; // セキュリティグループが見つからない場合は異常と判断
    }

    const securityGroup = response.SecurityGroups[0];

    // インバウンドルールをチェック
    for (const rule of securityGroup.IpPermissions || []) {
      // HTTPポート(80)のルールを探す
      if (rule.FromPort === 80 || rule.ToPort === 80) {
        // 0.0.0.0/0からのアクセスが許可されているかチェック
        for (const ipRange of rule.IpRanges || []) {
          if (ipRange.CidrIp === "0.0.0.0/0") {
            return false; // 正常
          }
        }
      }
    }

    return true; // 0.0.0.0/0からのHTTPアクセスが許可されていない（異常）
  } catch (error) {
    console.error(`Error checking ALB security group: ${error}`);
    return true; // エラーの場合は異常とみなす
  }
}

/**
 * EC2に付与されているセキュリティグループがインバウンドにALBからポート8080の通信許可が設定されているかを判定する
 * @param ec2SecurityGroupIds EC2のセキュリティグループIDの配列
 * @param albSecurityGroupId ALBのセキュリティグループID
 * @returns 少なくとも一つのEC2でALBからの通信が許可されていない場合はtrue（異常）、すべて許可されている場合はfalse（正常）
 */
async function checkEc2SecurityGroupsDirect(
  ec2SecurityGroupIds: string[],
  albSecurityGroupId: string,
): Promise<boolean> {
  try {
    const params = {
      GroupIds: ec2SecurityGroupIds,
    };

    const response = await ec2.describeSecurityGroups(params).promise();

    if (!response.SecurityGroups || response.SecurityGroups.length === 0) {
      console.error(`No security groups found for the provided IDs`);
      return true; // セキュリティグループが見つからない場合は異常と判断
    }

    // 各セキュリティグループをチェック
    for (const securityGroup of response.SecurityGroups) {
      let hasValidRule = false;

      // インバウンドルールをチェック
      for (const rule of securityGroup.IpPermissions || []) {
        // ポート8080のルールを探す
        if (rule.FromPort === 8080 || rule.ToPort === 8080) {
          // ALBのセキュリティグループからのアクセスが許可されているかチェック
          for (const userIdGroupPair of rule.UserIdGroupPairs || []) {
            if (userIdGroupPair.GroupId === albSecurityGroupId) {
              hasValidRule = true;
              break;
            }
          }
        }

        if (hasValidRule) {
          break;
        }
      }

      if (!hasValidRule) {
        console.log(
          `Security group ${securityGroup.GroupId} does not allow traffic from ALB on port 8080`,
        );
        return true; // 少なくとも一つのセキュリティグループで異常
      }
    }

    return false; // すべてのセキュリティグループで正常
  } catch (error) {
    console.error(`Error checking EC2 security groups: ${error}`);
    return true; // エラーの場合は異常とみなす
  }
}

/**
 * EC2インスタンスがシャットダウンされているかどうかを判定する
 * @param instanceIds EC2インスタンスIDの配列
 * @returns 少なくとも一つのインスタンスがシャットダウンされている場合はtrue（異常）、そうでない場合はfalse（正常）
 */
async function checkEc2StatusDirect(instanceIds: string[]): Promise<boolean> {
  try {
    // インスタンスの詳細情報を取得
    const describeParams = {
      InstanceIds: instanceIds,
    };

    const response = await ec2.describeInstances(describeParams).promise();

    if (!response.Reservations || response.Reservations.length === 0) {
      console.error("No EC2 instances found");
      return true; // インスタンスが見つからない場合は異常
    }

    // 各インスタンスのステータスをチェック
    for (const reservation of response.Reservations) {
      for (const instance of reservation.Instances || []) {
        // インスタンスの状態をチェック
        // 'running' 以外の状態（'stopped', 'stopping', 'terminated'など）はシャットダウンとみなす
        if (instance.State && instance.State.Name !== "running") {
          console.log(
            `Instance ${instance.InstanceId} is not running. Current state: ${instance.State.Name}`,
          );
          return true; // シャットダウンされたインスタンスが見つかった（異常）
        }
      }
    }

    return false; // すべてのインスタンスが正常に稼働している
  } catch (error) {
    console.error(`Error checking EC2 status: ${error}`);
    return true; // エラーの場合は異常とみなす
  }
}

/**
 * 新しいロジックに基づいてEC2プロセスの状態を判定する
 * 1. LOADBALANCER_DNS_NAMEに対するHTTPリクエストが200を返す → 正常
 * 2. そうでなければ、他の監視状態（ALB SG、EC2 SG、EC2）が異常 → 正常
 * 3. すべてが正常 → 異常
 * @returns プロセスが異常の場合はtrue、正常の場合はfalse
 */
async function checkEc2ProcessWithNewLogic(): Promise<boolean> {
  try {
    // 1. ロードバランサーのヘルスチェック
    const isLoadBalancerHealthy = await checkLoadBalancerHealth();

    if (isLoadBalancerHealthy) {
      console.log(
        "Load balancer is healthy (returns 200) - EC2 Process is normal",
      );
      return false; // 正常
    }

    // 2. 他のコンポーネントの状態を直接チェック
    // リソースIDを取得
    const albSecurityGroupId = await getAlbSecurityGroupId();
    const ec2SecurityGroupIds = await getEc2SecurityGroupIds();
    const instanceIds = await getEc2InstanceIds();

    // 各コンポーネントの状態を直接確認
    const isAlbSgAbnormal =
      await checkAlbSecurityGroupDirect(albSecurityGroupId);
    const isEc2SgAbnormal = await checkEc2SecurityGroupsDirect(
      ec2SecurityGroupIds,
      albSecurityGroupId,
    );
    const isEc2OsAbnormal = await checkEc2StatusDirect(instanceIds);

    console.log(
      `Component states - ALB SG: ${isAlbSgAbnormal ? "Abnormal" : "Normal"}, EC2 SG: ${isEc2SgAbnormal ? "Abnormal" : "Normal"}, EC2: ${isEc2OsAbnormal ? "Abnormal" : "Normal"}`,
    );

    // いずれかのコンポーネントが異常の場合は正常とみなす
    if (isAlbSgAbnormal || isEc2SgAbnormal || isEc2OsAbnormal) {
      console.log(
        "At least one other component is abnormal - EC2 Process is normal",
      );
      return false; // 正常
    }

    // 3. すべてが正常の場合は異常とみなす
    console.log(
      "All components are normal but load balancer is not healthy - EC2 Process is abnormal",
    );
    return true; // 異常
  } catch (error) {
    console.error(`Error in checkEc2ProcessWithNewLogic: ${error}`);
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
    const resilienceScenarioTableName =
      process.env.RESILIENCE_SCENARIO_TABLE_NAME || "ResilienceScenarioTable";

    const params = {
      TableName: resilienceScenarioTableName,
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

/**
 * リソースマッピングテーブルからEC2のセキュリティグループIDを取得する
 * @returns セキュリティグループIDの配列
 */
async function getEc2SecurityGroupIds(): Promise<string[]> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const params = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "EC2_SG",
      },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item || !result.Item.ResourceId) {
      throw new Error(
        "EC2 security group IDs not found in resource mapping table",
      );
    }

    // 単一のIDの場合は配列に変換、既に配列の場合はそのまま使用
    const resourceIds = Array.isArray(result.Item.ResourceId)
      ? result.Item.ResourceId
      : [result.Item.ResourceId];

    return resourceIds;
  } catch (error) {
    console.error(`Error getting EC2 security group IDs: ${error}`);
    throw error;
  }
}

/**
 * リソースマッピングテーブルからALBのセキュリティグループIDを取得する
 * @returns セキュリティグループID
 */
async function getAlbSecurityGroupId(): Promise<string> {
  try {
    const resourceMappingTableName =
      process.env.RESOURCE_MAPPING_TABLE_NAME || "ResourceMappingTable";

    const params = {
      TableName: resourceMappingTableName,
      Key: {
        ResourceType: "ALB_SG",
      },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item || !result.Item.ResourceId) {
      throw new Error(
        "ALB security group ID not found in resource mapping table",
      );
    }

    return result.Item.ResourceId;
  } catch (error) {
    console.error(`Error getting ALB security group ID: ${error}`);
    throw error;
  }
}

export const handler = async (event: SfnParallelEvent, context: Context) => {
  try {
    console.log("Checking EC2 process status with new logic...");

    // 新しいロジックでEC2プロセス状態をチェック
    const isProcessDown = await checkEc2ProcessWithNewLogic();

    // DynamoDBを更新
    // プロセスが異常の場合は "Red"、正常の場合は "Green"
    const currentState = isProcessDown ? "Red" : "Green";
    await updateDynamoDBState("EC2 Process", currentState);

    // レスポンスを返す
    // CurrentStateが "Green" の場合は solved: true、"Red" の場合は solved: false
    const response = {
      solved: currentState === "Green",
    };

    return response;
  } catch (error) {
    console.error(`Error in handler: ${error}`);
    throw error;
  }
};
