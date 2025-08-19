# Sample Interactive Incident Learning Simulator

Sample Interactive Incident Learning Simulatorは、AWSリソースを使用したカオスエンジニアリングとセキュリティテストのためのプラットフォームです。このプロジェクトは、障害注入と監視機能を備えたデモアプリケーションを提供します。

## プロジェクト概要

このプロジェクトは以下の主要コンポーネントで構成されています：

- **CDKインフラストラクチャ**: AWS CDKを使用してAWSリソースをデプロイ
- **デモアプリ**: EC2インスタンスで実行されるJavaアプリケーション（Todoアプリ）とAurora PostgreSQLデータベース
- **Webアプリケーション**: React + Viteで構築されたフロントエンドアプリケーション
- **障害注入機能**: 様々なシナリオでの障害をシミュレートする機能
- **監視機能**: 障害の検出と記録を行う機能

TIPS: 障害注入機能や監視機能の設計に関しては、[メモアプリケーションシステム設計書](./cdk/README.md)を参照してください。

## 前提条件

このプロジェクトを実行するには、以下のツールとアカウントが必要です：

- **Node.js**: バージョン18以上
- **AWS CLI**: 最新バージョン
- **AWS CDK**: バージョン2.196.0以上
- **AWS アカウント**: デプロイ先のAWSアカウント
- **AWS認証情報**: AWSリソースをデプロイするための適切な権限を持つIAMユーザーまたはロール

## インストール手順

1. リポジトリをクローンします：

```bash
git clone https://github.com/aws-samples/sample-interactive-incident-learning-simulator.git
cd sample-interactive-incident-learning-simulator
```

2. 依存関係をインストールします：

```bash
npm ci
```

## デプロイ手順

1. AWS認証情報を設定します：

```bash
aws configure
```

2. （オプション）CDKブートストラップを実行します（初回のみ）：

```bash
npx cdk bootstrap
```

3. CDKスタックをデプロイします：

```bash
npm run cdk:deploy
```

- プロファイルを利用する場合は、以下をご利用ください

```bash
npm run cdk:deploy -- -- --profile {your_profile}
```

デプロイが完了すると、以下の出力が表示されます：

- リージョン情報
- WebアプリケーションのURL（CloudFront Distribution URL）
- デモアプリケーションのURL（ALB DNS名）

## 使用方法

### Webアプリケーションへのアクセス

デプロイ完了後に表示されるCloudFront Distribution URLを使用して、Webアプリケーションにアクセスできます：

```
https://<cloudfront-distribution-domain-name>
```

### デモアプリケーション（Todoアプリ）へのアクセス

デプロイ完了後に表示されるALB DNS名を使用して、デモアプリケーションにアクセスできます：

```
http://<alb-dns-name>
```

### 障害注入と監視

Webアプリケーションから、様々な障害シナリオを選択して実行できます。障害の発生と検出はWebアプリケーション上で確認できます。

## プロジェクト構成

```
sample-interactive-incident-learning-simulator/
├── cdk/                   # CDKインフラストラクチャコード
│   ├── bin/               # CDKアプリケーションのエントリーポイント
│   ├── lib/               # CDKスタックとコンストラクト
│   │   ├── construct/     # 再利用可能なコンストラクト
│   │   │   ├── demoapp/   # デモアプリケーション関連のコンストラクト
│   │   │   └── utils/     # ユーティリティコンストラクト
│   ├── lambda/            # Lambda関数のソースコード
│   └── schema/            # GraphQLスキーマ
├── demoapp/               # Javaデモアプリケーション（Todoアプリ）
│   ├── src/               # ソースコード
│   └── build.gradle       # Gradleビルド設定
├── webapp/                # フロントエンドWebアプリケーション
│   ├── public/            # 静的ファイル
│   └── src/               # Reactアプリケーションのソースコード
└── package.json           # プロジェクトの依存関係とスクリプト
```

## 開発

### Webアプリケーションのローカル開発

```bash
npm run webapp:dev
```

### Webアプリケーションのビルド

```bash
npm run webapp:build
```

## 注意事項

- このプロジェクトは、AWSリソースを作成します。これにより、AWSアカウントに料金が発生する可能性があります。
- デプロイされたリソースは、`npm run cdk:destroy`コマンドで削除できます。
- CDKスタックには`RemovalPolicy.DESTROY`が設定されているため、スタックを削除するとすべてのリソースが削除されます。
- このプロジェクトではcdk-nagによるセキュリティチェックを実施していますが、カオスエンジニアリングの実習目的で意図的にセキュリティ設定を緩和する必要があるリソースについては、suppression（抑制設定）を追加しています。本番環境では、これらの設定を適切に見直してください。
