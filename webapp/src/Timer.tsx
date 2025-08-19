import React, { useState, useEffect, useRef, useContext } from "react";
import { formatTime } from "./Ranking";
import "./TimerApp.css";
import { registerTimerReset } from "./gameReset";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/api";
import { updatedGameStateSub } from "./graphql/subscriptions";
import { GraphQLSubscription } from "@aws-amplify/api";
import { RecordContext } from "./App";

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
type GameStateSubscriptionType = {
  updatedGameStateSub: {
    state: string;
  } | null;
};

interface RecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegister: (pattern: string) => void;
  time: number;
  pattern: string;
}

const RecordModal: React.FC<RecordModalProps> = ({
  isOpen,
  onClose,
  onRegister,
  time,
  pattern,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-message">
          <h1>記録</h1>
          <h1>{formatTime(time)}</h1>
          <p>パターン: {pattern}</p>
        </div>
        <div className="modal-buttons">
          <button
            onClick={() => onRegister(pattern)}
            className="modal-button register-button"
          >
            登録
          </button>
          <button onClick={onClose} className="modal-button cancel-button">
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
};

const Timer: React.FC = () => {
  const [time, setTime] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(
    null,
  );
  const [gameMode, setGameMode] = useState<string>("Easy"); // デフォルトは Easy
  const [patternType, setPatternType] = useState<string>("Security"); // デフォルトは Security
  const workerRef = useRef<Worker | null>(null);
  const fallbackIntervalRef = useRef<number | null>(null);
  const apiRecordEndpoint =
    import.meta.env.VITE_APP_APIGW_RECORD_ENDPOINT || "";
  const apiRecordapiKey = import.meta.env.VITE_APP_APIGW_RECORD_API_KEY;
  const previousGameStateRef = useRef<string>("ready");
  const [workerSupported, setWorkerSupported] = useState<boolean>(true);

  // RecordContextからsetRecordAddedを取得
  const { setRecordAdded } = useContext(RecordContext);

  // Web Workerの初期化
  useEffect(() => {
    // Web Workerを作成
    try {
      workerRef.current = new Worker(
        new URL("./timer.worker.ts", import.meta.url),
      );

      // Workerからのメッセージを受信
      workerRef.current.onmessage = (e) => {
        const { type, time: workerTime, error } = e.data;

        switch (type) {
          case "TIME_UPDATE":
            setTime(workerTime);
            break;
          case "TIMER_STARTED":
            setIsRunning(true);
            console.log("Timer started in worker");
            break;
          case "TIMER_STOPPED":
            setIsRunning(false);
            setTime(workerTime);
            console.log("Timer stopped in worker, final time:", workerTime);
            break;
          case "TIMER_RESET":
            setIsRunning(false);
            setTime(0);
            console.log("Timer reset in worker");
            break;
          case "CURRENT_TIME":
            setTime(workerTime);
            break;
          case "ERROR":
            console.error("Worker error:", error);
            break;
          default:
            console.warn("Unknown worker message type:", type);
        }
      };

      // Workerエラーハンドリング
      workerRef.current.onerror = (error) => {
        console.error("Worker error:", error);
        setWorkerSupported(false);
      };
    } catch (error) {
      console.error("Failed to create Web Worker:", error);
      setWorkerSupported(false);
      console.warn(
        "Web Worker not supported, falling back to main thread timer",
      );
    }

    // クリーンアップ
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
      }
    };
  }, []);

  // パターン文字列を生成
  const getPattern = () => {
    return `${gameMode} ${patternType}`;
  };

  // ゲームの開始（APIを呼び出してシナリオを実行）
  const startGame = async () => {
    try {
      // API Gateway URLを環境変数から取得(インシデント発生用の API Gateway)
      const apiUrl = import.meta.env.VITE_APP_APIGW_INCIDENT_ENDPOINT;
      if (!apiUrl) {
        console.error("API Gateway URLが設定されていません");
        return false;
      }

      // パターンに応じたエンドポイントを決定
      let endpoint = "";
      if (patternType === "Security") {
        endpoint = gameMode === "Easy" ? "sec-easy" : "sec-hard";
      } else {
        endpoint = gameMode === "Easy" ? "res-easy" : "res-hard";
      }

      // APIを呼び出す
      const response = await fetch(`${apiUrl}api/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: import.meta.env.VITE_APP_APIGW_INCIDENT_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`APIリクエストエラー: ${response.status}`);
      }

      const data = await response.json();
      console.log("シナリオ開始API呼び出し成功:", data);
      return true;
    } catch (error) {
      console.error("シナリオ開始API呼び出しエラー:", error);
      return false;
    }
  };

  // タイマーの開始（Web Worker使用、フォールバック対応）
  const startTimer = async () => {
    if (!isRunning) {
      if (workerSupported && workerRef.current) {
        // Web Worker使用
        workerRef.current.postMessage({ type: "START" });
      } else {
        // フォールバック: メインスレッドでタイマー実行
        console.log("Using fallback timer on main thread");
        setIsRunning(true);
        const startTime = Date.now();
        fallbackIntervalRef.current = window.setInterval(() => {
          setTime(Date.now() - startTime);
        }, 10);
      }
    }
  };

  // タイマーの停止（Web Worker使用、フォールバック対応）
  const stopTimer = async () => {
    if (workerSupported && workerRef.current) {
      // Web Worker使用
      workerRef.current.postMessage({ type: "STOP" });
    } else {
      // フォールバック: メインスレッドのタイマー停止
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
      setIsRunning(false);
    }
  };

  // タイマーのリセット（Web Worker使用、フォールバック対応）
  const resetTimer = () => {
    if (workerSupported && workerRef.current) {
      // Web Worker使用
      workerRef.current.postMessage({ type: "RESET" });
    } else {
      // フォールバック: メインスレッドのタイマーリセット
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
      setIsRunning(false);
      setTime(0);
    }
    setRegistrationStatus(null);
  };

  // モードの切り替え
  const toggleMode = () => {
    setGameMode((prevMode) => (prevMode === "Easy" ? "Hard" : "Easy"));
  };

  // パターンタイプの切り替え
  const togglePatternType = () => {
    setPatternType((prevType) =>
      prevType === "Security" ? "Resiliency" : "Security",
    );
  };

  // モーダルを表示
  const showModal = async () => {
    setIsModalOpen(true);
  };

  // コンポーネントのマウント時にリセット関数を登録とサブスクリプションの設定
  useEffect(() => {
    // タイマーリセット関数を登録
    registerTimerReset(resetTimer);

    // AppSyncクライアントの生成
    const client = generateClient();

    try {
      // ゲーム状態のサブスクリプション
      const gameStateSubscription = client
        .graphql<GraphQLSubscription<GameStateSubscriptionType>>({
          query: updatedGameStateSub,
        })
        .subscribe({
          next: (result) => {
            // サブスクリプションからのデータをコンソールに出力
            console.log(
              "Timer: ゲーム状態が更新されました:",
              result.data?.updatedGameStateSub,
            );

            // ゲーム状態をステートに保存
            const newGameState = result.data?.updatedGameStateSub?.state;
            if (newGameState) {
              console.log(
                "Timer: ゲーム状態をステートに保存しました:",
                newGameState,
              );

              // ゲーム状態が'resetting'の場合、タイマーをリセット
              if (newGameState === "resetting") {
                stopTimer();
                resetTimer();
              } else if (newGameState === "ongoing") {
                startTimer();
              } else if (newGameState === "ready") {
                stopTimer();
                if (previousGameStateRef.current === "ongoing") {
                  console.log(
                    "Timer: ongoingからreadyへの変更を検出、モーダル表示",
                  );
                  showModal();
                }
              }

              previousGameStateRef.current = newGameState;
            }
          },
          error: (error: Error) => {
            console.error("Timer: ゲーム状態サブスクリプションエラー:", error);
          },
        });

      // コンポーネントのアンマウント時のクリーンアップ
      return () => {
        // サブスクリプションの解除
        if (gameStateSubscription) {
          gameStateSubscription.unsubscribe();
        }
      };
    } catch (error) {
      console.error("Timer: サブスクリプション設定エラー:", error);

      // エラー時のクリーンアップ
      return () => {};
    }
  }, []);

  // DynamoDBにデータを登録
  const registerTime = async () => {
    try {
      const response = await fetch(`${apiRecordEndpoint}record-ranking`, {
        method: "POST",
        headers: {
          Authorization: apiRecordapiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          time: new Date().getTime(), // パーティションキーと現在の時間を取得
          timer: time, // ソートキーとして実際の時間値（ミリ秒）を使用
          mode: gameMode, // 互換性のためにmodeも保持
          pattern: patternType, // 新しいパターン情報 (Easy-Security など)
        }),
      });

      const data = await response.json();

      // ToDo: data に関してエラーハンドリングを実装
      console.log(data);

      setRegistrationStatus("登録が完了しました！");
      setTimeout(() => {
        setRegistrationStatus(null);
      }, 3000);

      // タイマーを完全にリセット（Web Worker含む）
      resetTimer();

      // ランキングの再取得をトリガー
      setRecordAdded(true);
    } catch (error) {
      console.error("登録エラー:", error);
      setRegistrationStatus("登録に失敗しました。もう一度お試しください。");
    }
    setIsModalOpen(false);
  };

  // モーダルを閉じる
  const closeModal = () => {
    resetTimer();
    setIsModalOpen(false);
  };

  return (
    <div className="app-container">
      <div className="timer-container">
        <h1 className="timer-display">{formatTime(time)}</h1>

        {/* Web Worker状態表示（開発用） */}
        {!workerSupported && (
          <div
            className="worker-status"
            style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}
          >
            フォールバックモード: メインスレッド
          </div>
        )}

        {/* 難易度トグル */}
        <div className="mode-toggle-container">
          <span
            className={
              gameMode === "Easy"
                ? "mode-option active-green"
                : "mode-option inactive"
            }
          >
            Easy
          </span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={gameMode === "Hard"}
              onChange={toggleMode}
              disabled={isRunning}
            />
            <span className="toggle-slider"></span>
          </label>
          <span
            className={
              gameMode === "Hard"
                ? "mode-option active-red"
                : "mode-option inactive"
            }
          >
            Hard
          </span>
        </div>

        {/* Security/Resiliency トグル */}
        <div className="mode-toggle-container">
          <span
            className={
              patternType === "Security"
                ? "mode-option active-green"
                : "mode-option inactive"
            }
          >
            Security
          </span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={patternType === "Resiliency"}
              onChange={togglePatternType}
              disabled={isRunning}
            />
            <span className="toggle-slider"></span>
          </label>
          <span
            className={
              patternType === "Resiliency"
                ? "mode-option active-red"
                : "mode-option inactive"
            }
          >
            Resiliency
          </span>
        </div>

        <div className="timer-controls">
          <button
            onClick={startGame}
            disabled={isRunning}
            className={`timer-button start-button ${patternType === "Security" ? "start-button-security" : "start-button-resiliency"}`}
          >
            Start {getPattern()}
          </button>
        </div>

        {registrationStatus && (
          <div className="status-message">{registrationStatus}</div>
        )}

        <RecordModal
          isOpen={isModalOpen}
          onClose={closeModal}
          onRegister={registerTime}
          time={time}
          pattern={getPattern()}
        />
      </div>

      {/* <div className="ranking-section-container">
        <Ranking 
          apiEndpoint={apiRecordEndpoint} 
          onRecordAdded={recordAdded}
        />
      </div> */}
    </div>
  );
};

export default Timer;
