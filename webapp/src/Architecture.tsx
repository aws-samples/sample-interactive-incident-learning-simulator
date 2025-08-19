import React, { useState, useEffect } from "react";
import "./Architecture.css";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/api";
import { updatedCompnentSub } from "./graphql/subscriptions";
import { GraphQLSubscription } from "@aws-amplify/api";

// Amplifyの設定（App.tsxと同じ設定を使用）
Amplify.configure({
  API: {
    GraphQL: {
      endpoint: import.meta.env.VITE_APP_APPSYNC_URL || "",
      region: import.meta.env.VITE_APP_REGION || "us-east-1",
      defaultAuthMode: "apiKey",
      apiKey: import.meta.env.VITE_APP_APPSYNC_API_KEY || "",
    },
  },
});

// サブスクリプションの型定義
type ComponentSubscriptionType = {
  updatedCompnentSub: {
    component: string;
    state: string;
  } | null;
};

const Architecture: React.FC = () => {
  // ALBの状態を管理するステート（デフォルトは'normal'）
  const [albState, setAlbState] = useState<"normal" | "incident">("normal");
  // EC2のセキュリティグループ状態を管理するステート（デフォルトは'normal'）
  const [ec2sgState, setEc2sgState] = useState<"normal" | "incident">("normal");
  // EC2アイコン自体の状態を管理するステート（デフォルトは'normal'）
  const [ec2State, setEc2State] = useState<"normal" | "incident">("normal");
  // RDSのセキュリティグループ状態を管理するステート（デフォルトは'normal'）
  const [rdssgState, setRdssgState] = useState<"normal" | "incident">("normal");
  // CloudTrailの状態を管理するステート（デフォルトは'normal'）
  const [cloudtrailState, setCloudtrailState] = useState<"normal" | "incident">(
    "normal",
  );
  // S3の状態を管理するステート（デフォルトは'normal'）
  const [s3State, setS3State] = useState<"normal" | "incident">("normal");

  // AppSyncからのサブスクリプションを設定
  useEffect(() => {
    // AppSyncクライアントの生成
    const client = generateClient();

    try {
      // コンポーネント状態のサブスクリプション
      const componentSubscription = client
        .graphql<GraphQLSubscription<ComponentSubscriptionType>>({
          query: updatedCompnentSub,
        })
        .subscribe({
          next: (result) => {
            // サブスクリプションからのデータを処理
            const componentData = result.data?.updatedCompnentSub;
            console.log("コンポーネント状態が更新されました:", componentData);

            if (componentData) {
              // componentが"albsg"の場合、stateの内容をalbStateに代入
              if (componentData.component === "albsg") {
                if (
                  componentData.state === "normal" ||
                  componentData.state === "incident"
                ) {
                  setAlbState(componentData.state);
                  console.log(
                    `ALBの状態を${componentData.state}に更新しました`,
                  );
                } else {
                  console.warn(`不明なALB状態: ${componentData.state}`);
                }
              }

              // componentが"ec2sg"の場合、stateの内容をec2sgStateに代入
              if (componentData.component === "ec2sg") {
                if (
                  componentData.state === "normal" ||
                  componentData.state === "incident"
                ) {
                  setEc2sgState(componentData.state);
                  console.log(
                    `EC2セキュリティグループの状態を${componentData.state}に更新しました`,
                  );
                } else {
                  console.warn(
                    `不明なEC2セキュリティグループ状態: ${componentData.state}`,
                  );
                }
              }

              // componentが"ec2"の場合、stateの内容をec2Stateに代入
              if (componentData.component === "ec2") {
                if (
                  componentData.state === "normal" ||
                  componentData.state === "incident"
                ) {
                  setEc2State(componentData.state);
                  console.log(
                    `EC2の状態を${componentData.state}に更新しました`,
                  );
                } else {
                  console.warn(`不明なEC2状態: ${componentData.state}`);
                }
              }

              // componentが"rdssg"の場合、stateの内容をrdssgStateに代入
              if (componentData.component === "rdssg") {
                if (
                  componentData.state === "normal" ||
                  componentData.state === "incident"
                ) {
                  setRdssgState(componentData.state);
                  console.log(
                    `RDSセキュリティグループの状態を${componentData.state}に更新しました`,
                  );
                } else {
                  console.warn(
                    `不明なRDSセキュリティグループ状態: ${componentData.state}`,
                  );
                }
              }

              // componentが"cloudtrail"の場合、stateの内容をcloudtrailStateに代入
              if (componentData.component === "cloudtrail") {
                if (
                  componentData.state === "normal" ||
                  componentData.state === "incident"
                ) {
                  setCloudtrailState(componentData.state);
                  console.log(
                    `CloudTrailの状態を${componentData.state}に更新しました`,
                  );
                } else {
                  console.warn(`不明なCloudTrail状態: ${componentData.state}`);
                }
              }

              // componentが"s3"の場合、stateの内容をs3Stateに代入
              if (componentData.component === "s3") {
                if (
                  componentData.state === "normal" ||
                  componentData.state === "incident"
                ) {
                  setS3State(componentData.state);
                  console.log(`S3の状態を${componentData.state}に更新しました`);
                } else {
                  console.warn(`不明なS3状態: ${componentData.state}`);
                }
              }
            }
          },
          error: (error: Error) => {
            console.error("コンポーネント状態サブスクリプションエラー:", error);
          },
        });

      // クリーンアップ関数
      return () => {
        // サブスクリプションの解除
        if (componentSubscription) {
          componentSubscription.unsubscribe();
        }
      };
    } catch (error) {
      console.error("サブスクリプション設定エラー:", error);
    }
  }, []);

  return (
    <div className="architecture-container">
      <h3>システムアーキテクチャ</h3>
      <div className="architecture-diagram">
        {/* ALB with Security Group */}
        <div
          className={`alb-component ${albState === "incident" ? "sg-incident" : ""}`}
        >
          <div className="sg-label">Security Group</div>
          <div className="component-label">ALB</div>
          <img
            src="/elb.svg"
            alt="Application Load Balancer"
            className="aws-icon alb-icon"
          />
        </div>

        {/* EC2 Instances with Security Group */}
        <div
          className={`ec2-container ${ec2sgState === "incident" ? "sg-incident" : ""}`}
        >
          <div className="sg-label">Security Group</div>
          <div className="ec2-instance">
            <div className="component-label">EC2</div>
            <img
              src="/ec2.svg"
              alt="EC2 Instance"
              className={`aws-icon ec2-icon ${ec2State === "incident" ? "ec2-incident" : ""}`}
            />
          </div>
          <div className="ec2-instance">
            <div className="component-label">EC2</div>
            <img
              src="/ec2.svg"
              alt="EC2 Instance"
              className={`aws-icon ec2-icon ${ec2State === "incident" ? "ec2-incident" : ""}`}
            />
          </div>
        </div>

        {/* RDS with Security Group */}
        <div
          className={`rds-component ${rdssgState === "incident" ? "sg-incident" : ""}`}
        >
          <div className="rds-label">
            Security
            <br />
            Group
          </div>
          <div className="component-label">RDS</div>
          <img
            src="/rds.svg"
            alt="RDS Database"
            className="aws-icon rds-icon"
          />
        </div>

        {/* CloudTrail and S3 */}
        <div className="monitoring-storage-section">
          <div className="monitoring-component">
            <div className="component-label">CloudTrail</div>
            <img
              src="/cloudtrail.svg"
              alt="CloudTrail"
              className={`aws-icon cloudtrail-icon ${cloudtrailState === "incident" ? "ec2-incident" : ""}`}
            />
          </div>
          <div className="storage-component">
            <div className="component-label">S3</div>
            <img
              src="/s3.svg"
              alt="S3 Bucket"
              className={`aws-icon s3-icon ${s3State === "incident" ? "ec2-incident" : ""}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Architecture;
