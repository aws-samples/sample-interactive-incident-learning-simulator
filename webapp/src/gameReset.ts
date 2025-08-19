// gameReset.ts
// ゲームのリセット機能を提供する関数

// タイマーのリセット関数の型定義
type TimerResetFunction = () => void;
// GameStateの設定関数の型定義
type GameStateSetFunction = (state: string) => void;

// タイマーリセット関数を保持する変数
let timerResetFunction: TimerResetFunction | null = null;
// GameState設定関数を保持する変数
let gameStateSetFunction: GameStateSetFunction | null = null;

// タイマーリセット関数を登録する
export const registerTimerReset = (resetFunc: TimerResetFunction): void => {
  timerResetFunction = resetFunc;
};

// GameState設定関数を登録する
export const registerGameStateSet = (
  setGameStateFunc: GameStateSetFunction,
): void => {
  gameStateSetFunction = setGameStateFunc;
};

// ゲームリセット関数
export const gameReset = async (): Promise<void> => {
  console.log("ゲームリセット関数が実行されました");

  // ゲーム状態をresettingに設定
  if (gameStateSetFunction) {
    gameStateSetFunction("resetting");
    console.log("ゲーム状態をresettingに設定しました");
  } else {
    console.warn("GameState設定関数が登録されていません");
  }

  // タイマーリセット関数が登録されていれば実行
  if (timerResetFunction) {
    timerResetFunction();
  } else {
    console.warn("タイマーリセット関数が登録されていません");
  }

  try {
    // API Gateway URLを環境変数から取得
    const apiUrl = import.meta.env.VITE_APP_APIGW_INCIDENT_ENDPOINT;
    if (!apiUrl) {
      console.error("API Gateway URLが設定されていません");
      return;
    }

    // game-resetエンドポイントを呼び出す
    const response = await fetch(`${apiUrl}api/game-reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: import.meta.env.VITE_APP_APIGW_INCIDENT_API_KEY,
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`APIリクエストエラー: ${response.status}`);
    }

    console.log("ゲームリセットAPI呼び出し成功");
  } catch (error) {
    console.error("ゲームリセットAPI呼び出しエラー:", error);
  }
};
