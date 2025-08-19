// timer-worker.ts - Web Worker用の型定義

export interface TimerWorkerMessage {
  type: "START" | "STOP" | "RESET" | "GET_TIME";
  payload?: any;
}

export interface TimerWorkerResponse {
  type:
    | "TIME_UPDATE"
    | "TIMER_STARTED"
    | "TIMER_STOPPED"
    | "TIMER_RESET"
    | "CURRENT_TIME"
    | "ERROR";
  time?: number;
  error?: string;
}

export interface TimerWorkerState {
  isRunning: boolean;
  startTime: number | null;
  pausedTime: number;
}
