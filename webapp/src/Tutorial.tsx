import React, { useState, useEffect } from 'react';
import { TourProvider, useTour } from '@reactour/tour';
import './Tutorial.css';

// チュートリアルステップの定義
const tutorialSteps = [
  {
    selector: '.timer-container',
    content: (
      <div className="tutorial-content">
        <h3>🎯 カオスエンジニアリング タイマー</h3>
        <p>
          システムの障害復旧時間を測定するタイマーとシナリオの選択
        </p>
        <ul>
          <li><strong>開始</strong>: 選択したシナリオを注入し、準備ができたらタイマーが開始</li>
          <li><strong>停止</strong>: システムが正常復旧したタイミングでタイマーが自動で停止</li>
          <li><strong>記録</strong>: 復旧時間を セキュリティ/レジリエンス, Easy/Security に記録</li>
        </ul>
        <p className="tutorial-highlight">
          💡 <strong>目標</strong>: インシデント対応のプロセスを学びつつより短い復旧時間を目指しましょう！
        </p>
      </div>
    ),
    position: 'bottom',
  },
  {
    selector: '.architecture-section',
    content: (
      <div className="tutorial-content">
        <h3>🏗️ システムアーキテクチャ</h3>
        <p>
          このセクションでは、障害が発生するアプリのAWSアーキテクチャを確認できます
        </p>
        <ul>
          <li><strong>リアルタイム監視</strong>: 各コンポーネントの状態をリアルタイムで表示します</li>
          <li><strong>障害発生状況の可視化</strong>: 現在の障害発生状況をアーキテクチャ図から確認可能です</li>
        </ul>
      </div>
    ),
    position: 'top',
  },
  {
    selector: '.side-content.left-side',
    content: (
      <div className="tutorial-content">
        <h3>🔒 セキュリティランキング</h3>
        <p>
          セキュリティ関連の障害パターンでの復旧時間ランキングです。
        </p>
        <ul>
          <li><strong>それぞれのレベルごとに上位 3 位までが表示されます。上位を目指してセキュリティのインシデント対応を学びましょう！</strong></li>
        </ul>
      </div>
    ),
    position: 'right',
  },
  {
    selector: '.side-content.right-side',
    content: (
      <div className="tutorial-content">
        <h3>🛡️ レジリエンスランキング</h3>
        <p>
          レジリエンス関連の障害パターンでの復旧時間ランキングです。
        </p>
        <ul>
          <li><strong>それぞれのレベルごとに上位 3 位までが表示されます。上位を目指してレジリエンスのインシデント対応を学びましょう！</strong></li>
        </ul>
      </div>
    ),
    position: 'left',
  },
  {
    selector: '.reset-button-container',
    content: (
      <div className="tutorial-content">
        <h3>🔄 システムリセット</h3>
        <p>
          全てのコンポーネントを初期状態にリセットします。
        </p>
        <p className="tutorial-highlight">
          ⚠️ 実行中の障害を回復させ初期化するためにはリセットボタンをご利用ください
        </p>
      </div>
    ),
    position: 'top',
  },
];

// 代替設定：デフォルトナビゲーションを使用
const tourConfigAlternative = {
  steps: tutorialSteps,
  styles: {
    popover: (base: any) => ({
      ...base,
      '--reactour-accent': '#ff6b6b',
      borderRadius: '12px',
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
      maxWidth: '400px',
    }),
    maskArea: (base: any) => ({
      ...base,
      rx: 8,
    }),
    badge: (base: any) => ({
      ...base,
      left: 'auto',
      right: '-0.8125em',
      background: '#ff6b6b',
    }),
    controls: (base: any) => ({
      ...base,
      marginTop: '16px',
    }),
    navigation: (base: any) => ({
      ...base,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
    }),
  },
  showBadge: true,
  showCloseButton: true,
  showNavigation: true,
  showDots: true,
  disableDotsNavigation: false,
  disableKeyboardNavigation: false,
  className: 'demo-tour',
  maskClassName: 'demo-mask',
  highlightedMaskClassName: 'demo-highlighted',
  onClickMask: ({ setCurrentStep, currentStep, steps, setIsOpen }: any) => {
    console.log('マスクがクリックされました:', currentStep);
    if (currentStep === steps.length - 1) {
      console.log('最後のステップでマスクがクリックされました。チュートリアルを終了します。');
      setCurrentStep(0); // 最初のステップにリセット
      setIsOpen(false);
    } else {
      setCurrentStep(currentStep + 1);
    }
  },
  afterOpen: () => {
    console.log('チュートリアルが開始されました');
  },
  beforeClose: () => {
    console.log('チュートリアルが終了されます');
  },
  // チュートリアル終了時に最初のステップにリセット
  onRequestClose: ({ setCurrentStep, setIsOpen }: any) => {
    console.log('チュートリアルを終了し、次回は最初のステップから開始されます');
    setCurrentStep(0); // 最初のステップにリセット
    setIsOpen(false);
  },
  // カスタム閉じるボタン
  closeButton: ({ setCurrentStep, setIsOpen }: any) => {
    const handleClose = () => {
      console.log('閉じるボタンがクリックされました。次回は最初のステップから開始されます。');
      setCurrentStep(0); // 最初のステップにリセット
      setIsOpen(false);
    };

    return (
      <button 
        className="tour-close-button"
        onClick={handleClose}
        title="チュートリアルを終了"
      >
        ×
      </button>
    );
  },
  // 最後のステップで次へボタンをクリックした際の動作をカスタマイズ
  nextButton: ({ currentStep, setCurrentStep, steps, setIsOpen }: any) => {
    const isLastStep = currentStep === steps.length - 1;
    
    const handleClick = () => {
      console.log('次へボタンがクリックされました。現在のステップ:', currentStep);
      if (isLastStep) {
        console.log('最後のステップです。チュートリアルを終了し、次回は最初のステップから開始されます。');
        setCurrentStep(0); // 最初のステップにリセット
        setIsOpen(false);
      } else {
        setCurrentStep(currentStep + 1);
      }
    };

    return (
      <button 
        className={`tour-button ${isLastStep ? 'tour-button-finish' : 'tour-button-next'}`}
        onClick={handleClick}
      >
        {isLastStep ? '完了 ✨' : '次へ →'}
      </button>
    );
  },
};

// チュートリアル開始ボタンコンポーネント
const TutorialButton: React.FC = () => {
  const { setIsOpen, setCurrentStep } = useTour();

  const handleClick = () => {
    console.log('チュートリアルボタンがクリックされました。最初のステップから開始します。');
    setCurrentStep(0); // 確実に最初のステップに設定
    setIsOpen(true);
  };

  return (
    <button 
      className="tutorial-start-button"
      onClick={handleClick}
      title="チュートリアルを開始"
    >
      <span className="tutorial-icon">🎓</span>
      <span className="tutorial-text">チュートリアル</span>
    </button>
  );
};

// ウェルカムモーダル内のチュートリアル開始ボタンコンポーネント
const WelcomeStartButton: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  const { setIsOpen, setCurrentStep } = useTour();

  const handleClick = () => {
    console.log('ウェルカムモーダルからチュートリアル開始ボタンがクリックされました');
    onStart(); // ウェルカムモーダルを閉じる
    setTimeout(() => {
      console.log('チュートリアルを最初のステップから開始します');
      setCurrentStep(0); // 確実に最初のステップに設定
      setIsOpen(true); // 少し遅延してチュートリアルを開始
    }, 300); // モーダルのアニメーション完了を待つ
  };

  return (
    <button 
      className="welcome-button welcome-button-tutorial"
      onClick={handleClick}
    >
      📚 チュートリアルを開始
    </button>
  );
};

// メインのチュートリアルプロバイダーコンポーネント
interface TutorialProviderProps {
  children: React.ReactNode;
}

const Tutorial: React.FC<TutorialProviderProps> = ({ children }) => {
  const [showWelcome, setShowWelcome] = useState(false);

  // 初回訪問時にウェルカムメッセージを表示
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('demo-tutorial-seen');
    if (!hasSeenTutorial) {
      setShowWelcome(true);
    }
  }, []);

  // デバッグ用：Ctrl+Shift+Tでチュートリアルを強制開始
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'T') {
        console.log('デバッグ: チュートリアルを強制開始');
        localStorage.removeItem('demo-tutorial-seen');
        setShowWelcome(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleStartTutorial = () => {
    console.log('handleStartTutorial が呼ばれました');
    setShowWelcome(false);
    localStorage.setItem('demo-tutorial-seen', 'true');
  };

  const handleSkipTutorial = () => {
    console.log('handleSkipTutorial が呼ばれました');
    setShowWelcome(false);
    localStorage.setItem('demo-tutorial-seen', 'true');
  };

  return (
    <TourProvider 
      {...tourConfigAlternative}
    >
      {children}
      
      {/* ウェルカムモーダル */}
      {showWelcome && (
        <div className="welcome-modal-overlay">
          <div className="welcome-modal">
            <div className="welcome-header">
              <h2>🎉 interactive incident learning simulator へようこそ！</h2>
            </div>
            <div className="welcome-content">
              <p>
                このデモアプリケーションでは、AWSリソースを使用したカオスエンジニアリングを学ぶことができます。
                レジリエンスやセキュリティに関連したインシデント対応を楽しくゲーム感覚で学びましょう！
              </p>
              <p>
                初めてご利用の方は、チュートリアルで基本的な使い方を学ぶことをお勧めします。
              </p>
            </div>
            <div className="welcome-buttons">
              <WelcomeStartButton onStart={handleStartTutorial} />
              <button 
                className="welcome-button welcome-button-skip"
                onClick={handleSkipTutorial}
              >
                スキップ
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* チュートリアル開始ボタン */}
      <div className="tutorial-button-container">
        <TutorialButton />
      </div>
    </TourProvider>
  );
};

export default Tutorial;
