# interactive incident learning simulator - Web Application

interactive incident learning simulatorのフロントエンドアプリケーションです。カオスエンジニアリングとセキュリティテストのためのWebインターフェースを提供します。

## 概要

このWebアプリケーションは、AWSリソースに対する障害注入とセキュリティテストを管理・監視するためのダッシュボードです。リアルタイムでシステムの状態を監視し、障害シナリオの実行と結果の可視化を行います。

## 主要機能

- **リアルタイム監視**: AWSリソースの状態をリアルタイムで監視
- **アーキテクチャ可視化**: システム構成とコンポーネントの状態を視覚的に表示
- **タイマー機能**: 障害対応時間の計測とランキング表示
- **障害注入制御**: セキュリティとレジリエンスのテストシナリオを実行
- **システムリセット**: テスト環境を初期状態に復元

## 技術スタック

- **フレームワーク**: React 19.0.0
- **ビルドツール**: Vite 6.2.0
- **言語**: TypeScript 5.7.2
- **状態管理**: React Context API
- **リアルタイム通信**: AWS AppSync (GraphQL Subscriptions)
- **AWS統合**: AWS Amplify 6.14.4
- **スタイリング**: CSS Modules

## 前提条件

- Node.js 18以上
- npm または yarn
- AWS AppSyncエンドポイントとAPIキー（CDKデプロイ後に取得）

## インストール手順

1. 依存関係をインストール：

```bash
npm install
```

## 環境設定

アプリケーションの実行には以下の環境変数が必要です：

```bash
# .env.local ファイルを作成し、以下の変数を設定してください
VITE_APP_APPSYNC_URL=<AWS AppSyncのGraphQLエンドポイント>
VITE_APP_REGION=<AWSリージョン>
VITE_APP_APPSYNC_API_KEY=<AWS AppSyncのAPIキー>
```

これらの値は、CDKスタックのデプロイ完了後に出力されます。

## 開発

### 開発サーバーの起動

```bash
npm run dev
```

開発サーバーが起動し、通常は `http://localhost:5173` でアクセスできます。

### ビルド

プロダクション用ビルドを作成：

```bash
npm run build
```

ビルド結果は `dist/` ディレクトリに出力されます。

### プレビュー

ビルド結果をローカルでプレビュー：

```bash
npm run preview
```

### リンティング

コードの品質チェック：

```bash
npm run lint
```

## プロジェクト構成

```
webapp/
├── public/                 # 静的ファイル
│   └── *.svg              # AWSサービスアイコン
├── src/
│   ├── components/        # Reactコンポーネント
│   │   ├── App.tsx        # メインアプリケーション
│   │   ├── Timer.tsx      # タイマー機能
│   │   ├── Architecture.tsx # アーキテクチャ表示
│   │   ├── Ranking.tsx    # ランキング表示
│   │   └── ResetButton.tsx # リセット機能
│   ├── contexts/          # React Context
│   ├── graphql/           # GraphQL定義
│   │   ├── queries.ts     # クエリ定義
│   │   ├── mutations.ts   # ミューテーション定義
│   │   └── subscriptions.ts # サブスクリプション定義
│   ├── types/             # TypeScript型定義
│   ├── assets/            # 画像・アイコン
│   └── *.css             # スタイルシート
├── index.html             # HTMLテンプレート
├── vite.config.ts         # Vite設定
└── package.json           # 依存関係とスクリプト
```

## 主要コンポーネント

### App.tsx

- アプリケーションのメインコンポーネント
- AWS Amplifyの設定とGraphQLサブスクリプションの管理
- 全体的な状態管理

### Timer.tsx

- 障害対応時間の計測機能
- Web Workerを使用した高精度タイマー
- リアルタイムでの時間表示

### Architecture.tsx

- システムアーキテクチャの可視化
- AWSリソースの状態表示
- コンポーネント間の関係性を図示

### Ranking.tsx

- 過去の対応時間ランキング表示
- 時間フォーマット機能

## AWS統合

このアプリケーションは以下のAWSサービスと統合されています：

- **AWS AppSync**: GraphQLによるリアルタイムデータ同期
- **Amazon DynamoDB**: 状態データとランキングデータの保存
- **AWS Lambda**: バックエンド処理
- **Amazon CloudFront**: 静的ファイルの配信

## 開発ガイドライン

### コーディング規約

- TypeScriptの厳密な型チェックを使用
- ESLintルールに従ったコード品質の維持
- React Hooksの適切な使用

### 状態管理

- React Context APIを使用したグローバル状態管理
- コンポーネント間でのpropsドリリングを避ける

### スタイリング

- CSS Modulesを使用したスコープ化されたスタイル
- レスポンシブデザインの実装

## トラブルシューティング

### よくある問題

1. **環境変数が設定されていない**

   - `.env.local`ファイルが正しく設定されているか確認
   - CDKデプロイが完了しているか確認

2. **GraphQLエンドポイントに接続できない**

   - AWS AppSyncのエンドポイントURLが正しいか確認
   - APIキーが有効か確認

3. **リアルタイム更新が動作しない**
   - WebSocketの接続状態を確認
   - ブラウザの開発者ツールでネットワークエラーを確認

## 関連ドキュメント

- [プロジェクト全体のREADME](../README.md)
- [システム設計書](../cdk/README.md)
- [デモアプリケーション](../cdk/demoapp/README.md)
