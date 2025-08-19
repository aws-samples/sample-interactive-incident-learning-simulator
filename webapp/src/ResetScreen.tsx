import React from "react";
import "./ResetScreen.css";
import ResetButton from "./ResetButton";

interface ResetScreenProps {}

const ResetScreen: React.FC<ResetScreenProps> = () => {
  return (
    <div className="reset-screen">
      <div className="reset-content">
        <h2>ゲームをリセット中です</h2>
        <p>しばらくお待ちください。</p>
        <div className="loading-spinner">
          <div className="spinner"></div>
        </div>
        <div className="reset-button-container">
          <ResetButton />
        </div>
      </div>
    </div>
  );
};

export default ResetScreen;
