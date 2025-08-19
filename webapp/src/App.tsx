import { useEffect, useState, createContext } from "react";
import Timer from "./Timer";
import Architecture from "./Architecture";
import ResetScreen from "./ResetScreen";
import Ranking from "./Ranking";
import ResetButton from "./ResetButton";
import "./App.css";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/api";
import {
  updatedCompnentSub,
  updatedGameStateSub,
} from "./graphql/subscriptions";
import { GraphQLSubscription } from "@aws-amplify/api";
import { GameStateProvider, useGameState } from "./contexts/GameStateContext";
import { registerGameStateSet } from "./gameReset";
import Tutorial from "./Tutorial";

// Amplifyの設定
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

type GameStateSubscriptionType = {
  updatedGameStateSub: {
    state: string;
  } | null;
};

// タイム登録イベント用のコンテキストを作成
export const RecordContext = createContext<{
  recordAdded: boolean;
  setRecordAdded: React.Dispatch<React.SetStateAction<boolean>>;
}>({
  recordAdded: false,
  setRecordAdded: () => {},
});

function App() {
  // GameStateContextからgameStateを取得
  const { gameState, setGameState } = useGameState();
  const [recordAdded, setRecordAdded] = useState<boolean>(false);
  const apiRecordEndpoint =
    import.meta.env.VITE_APP_APIGW_RECORD_ENDPOINT || "";
  const apiRecordapiKey = import.meta.env.VITE_APP_APIGW_RECORD_API_KEY;

  useEffect(() => {
    // GameState設定関数を登録
    registerGameStateSet(setGameState);

    // AppSync ARNをコンソールに出力
    const appsyncArn = import.meta.env.VITE_APP_APPSYNC_ARN || "";
    console.log("AppSync ARN:", appsyncArn);

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
            // サブスクリプションからのデータをコンソールに出力
            console.log(
              "コンポーネント状態が更新されました:",
              result.data?.updatedCompnentSub,
            );
          },
          error: (error: Error) => {
            console.error("コンポーネント状態サブスクリプションエラー:", error);
          },
        });

      // ゲーム状態のサブスクリプション
      const gameStateSubscription = client
        .graphql<GraphQLSubscription<GameStateSubscriptionType>>({
          query: updatedGameStateSub,
        })
        .subscribe({
          next: (result) => {
            // サブスクリプションからのデータをコンソールに出力
            console.log(
              "ゲーム状態が更新されました:",
              result.data?.updatedGameStateSub,
            );

            // ゲーム状態をステートに保存
            const newGameState = result.data?.updatedGameStateSub?.state;
            if (newGameState) {
              setGameState(newGameState);
              console.log("ゲーム状態をステートに保存しました:", newGameState);
            }
          },
          error: (error: Error) => {
            console.error("ゲーム状態サブスクリプションエラー:", error);
          },
        });

      // クリーンアップ関数
      return () => {
        // サブスクリプションの解除
        if (componentSubscription) {
          componentSubscription.unsubscribe();
        }
        if (gameStateSubscription) {
          gameStateSubscription.unsubscribe();
        }
      };
    } catch (error) {
      console.error("サブスクリプション設定エラー:", error);
    }
  }, [setGameState]);

  // recordAddedがtrueになったら一定時間後にfalseに戻す
  useEffect(() => {
    if (recordAdded) {
      console.log("新しい記録が追加されました。ランキングを更新します。");
      // 3秒後にrecordAddedをfalseに戻す
      const timer = setTimeout(() => {
        setRecordAdded(false);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [recordAdded]);

  return (
    <Tutorial>
      {/* gameStateがresettingの場合、リセット画面を表示 */}
      {gameState === "resetting" && <ResetScreen />}

      <RecordContext.Provider value={{ recordAdded, setRecordAdded }}>
        <div className="app-layout">
          <div className="main-content">
            <div className="side-content left-side">
              <h2 className="side-title">Security</h2>
              <Ranking
                apiEndpoint={apiRecordEndpoint}
                onRecordAdded={recordAdded}
                pattern="Security"
                apiRecordapiKey={apiRecordapiKey}
              />
            </div>
            <div className="center-content">
              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <h1>interactive incident learning simulator</h1>
              </div>
              {/* ゲーム状態の表示を削除 */}
              <Timer />
              {/* アーキテクチャをタイマーの下に配置 */}
              <div className="architecture-section">
                <Architecture />
              </div>
              {/* システムコンポーネントの下部にリセットボタンを配置 */}
              <div className="reset-button-container">
                <ResetButton />
              </div>
            </div>
            <div className="side-content right-side">
              <h2 className="side-title">Resiliency</h2>
              <Ranking
                apiEndpoint={apiRecordEndpoint}
                onRecordAdded={recordAdded}
                pattern="Resiliency"
                apiRecordapiKey={apiRecordapiKey}
              />
            </div>
          </div>
        </div>
      </RecordContext.Provider>
    </Tutorial>
  )
}

export default function AppWrapper() {
  return (
    <GameStateProvider>
      <App />
    </GameStateProvider>
  );
}
