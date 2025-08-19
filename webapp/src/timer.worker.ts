// timer.worker.ts - Web Worker implementation for timer functionality
import type {
  TimerWorkerMessage,
  TimerWorkerResponse,
} from "./types/timer-worker";

let isRunning = false;
let startTime: number | null = null;
let pausedTime = 0;
let intervalId: number | null = null;

// メッセージハンドラー
self.onmessage = function (e: MessageEvent<TimerWorkerMessage>) {
  const { type, payload } = e.data;

  try {
    switch (type) {
      case "START":
        startTimer();
        break;
      case "STOP":
        stopTimer();
        break;
      case "RESET":
        resetTimer();
        break;
      case "GET_TIME":
        getCurrentTime();
        break;
      default:
        postMessage({
          type: "ERROR",
          error: `Unknown message type: ${type}`,
        } as TimerWorkerResponse);
    }
  } catch (error) {
    postMessage({
      type: "ERROR",
      error: error instanceof Error ? error.message : "Unknown error",
    } as TimerWorkerResponse);
  }
};

function startTimer() {
  if (!isRunning) {
    isRunning = true;
    startTime = Date.now() - pausedTime;

    // タイマー開始を通知
    postMessage({
      type: "TIMER_STARTED",
    } as TimerWorkerResponse);

    // 100ms間隔で時間を更新
    intervalId = setInterval(() => {
      if (isRunning && startTime !== null) {
        const currentTime = Date.now() - startTime;
        postMessage({
          type: "TIME_UPDATE",
          time: currentTime,
        } as TimerWorkerResponse);
      }
    }, 100);
  }
}

function stopTimer() {
  if (isRunning) {
    isRunning = false;
    const finalTime = startTime ? Date.now() - startTime : pausedTime;
    pausedTime = finalTime;

    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    // タイマー停止を通知
    postMessage({
      type: "TIMER_STOPPED",
      time: finalTime,
    } as TimerWorkerResponse);
  }
}

function resetTimer() {
  isRunning = false;
  startTime = null;
  pausedTime = 0;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  // タイマーリセットを通知
  postMessage({
    type: "TIMER_RESET",
  } as TimerWorkerResponse);
}

function getCurrentTime() {
  const currentTime =
    isRunning && startTime ? Date.now() - startTime : pausedTime;
  postMessage({
    type: "CURRENT_TIME",
    time: currentTime,
  } as TimerWorkerResponse);
}

// エラーハンドリング
self.onerror = function (error) {
  postMessage({
    type: "ERROR",
    error: error.message,
  } as TimerWorkerResponse);
};
