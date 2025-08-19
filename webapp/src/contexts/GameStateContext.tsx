import React, { createContext, useContext, useState, ReactNode } from "react";

// GameStateContextの型定義
interface GameStateContextType {
  gameState: string;
  setGameState: React.Dispatch<React.SetStateAction<string>>;
}

// GameStateContextの作成
const GameStateContext = createContext<GameStateContextType | undefined>(
  undefined,
);

// GameStateProviderのProps型定義
interface GameStateProviderProps {
  children: ReactNode;
}

/**
 * ゲーム状態を管理するプロバイダーコンポーネント
 * アプリケーション全体でゲーム状態を共有します
 */
export const GameStateProvider: React.FC<GameStateProviderProps> = ({
  children,
}) => {
  // ゲーム状態を保存するステート（デフォルトは'ready'）
  const [gameState, setGameState] = useState<string>("ready");

  const value: GameStateContextType = {
    gameState,
    setGameState,
  };

  return (
    <GameStateContext.Provider value={value}>
      {children}
    </GameStateContext.Provider>
  );
};

/**
 * GameStateContextを使用するためのカスタムフック
 * コンポーネント内でゲーム状態にアクセスする際に使用します
 *
 * @returns GameStateContextの値
 * @throws GameStateProvider外で使用された場合にエラーをスロー
 */
export const useGameState = (): GameStateContextType => {
  const context = useContext(GameStateContext);
  if (context === undefined) {
    throw new Error("useGameState must be used within a GameStateProvider");
  }
  return context;
};

export default GameStateContext;
