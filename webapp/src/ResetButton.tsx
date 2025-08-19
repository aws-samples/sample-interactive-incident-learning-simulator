import React from "react";
import { gameReset } from "./gameReset";
import "./ResetButton.css";

interface ResetButtonProps {
  className?: string;
  label?: string;
}

/**
 * リセットボタンコンポーネント
 * ゲームのリセット機能を提供するボタンを表示します
 */
const ResetButton: React.FC<ResetButtonProps> = ({
  className = "timer-button reset-button",
  label = "Reset",
}) => {
  return (
    <button onClick={gameReset} className={className}>
      {label}
    </button>
  );
};

export default ResetButton;
