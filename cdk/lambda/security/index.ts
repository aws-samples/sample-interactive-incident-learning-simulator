// セキュリティシナリオのLambda関数をエクスポート
import * as easy from "./easy";
import * as hard from "./hard";

export const easyHandler = easy.handler;
export const hardHandler = hard.handler;
