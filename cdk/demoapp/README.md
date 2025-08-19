# webapp-java

## 概要

本アプリケーションは、infra 上で Java アプリケーションの動作確認を行うためのサンプルアプリケーションになります。
実行すると、Todoアプリが起動します

## ローカルでの動作確認

### ローカルに DB を構築する

実行させたい環境に、PostgreSQL をインストール、もしくは Docker にて起動させてください。
その際に、DB にアクセスするユーザ名とパスワードは控えておいてください。

### 環境変数の設定

3 つの環境変数を定義してください。DB の構築時に控えておいた、ユーザ名とパスワードを設定してください。

```sh
$ export DB_ENDPOINT=localhost
$ export DB_USERNAME={構築時に設定したユーザ名}
$ export DB_PASSWORD={構築時に設定したパスワード}
```

### テーブルの初期化とサンプルデータの追加

`src/resources/application.properties` に設定されている、`spring.sql.init.mode=always`によって、起動時に必ず`src/main/resources/data.sql`と`src/main/resources/schema.sql`が呼び出され、DB が初期化されます。
本アプリケーションはサンプルのため、このような設定をしていますが、本番利用の際には DB の初期化やマイグレーションの実施方法について別途ご検討ください。

### 実行

次のコマンドを実行すると、localhost:8080 にアクセスして、アプリケーションの動作が確認できます。

```sh
./gradlew bootRun
```

## アプリケーションのビルド

次のコマンドを実行すると、`build/libs`に jar ファイルが生成されます。

```sh
./gradlew build
```

## AWS上での構成

AWS上では標準的なWeb3層の構成を取ります。
ALB-EC2(2台)-RDSという構成です。EC2はAuto Scalingを利用せず、インスタンスが2台ALBのターゲットグループに登録される形をとります。
テレメトリデータの取得にはAWS Distro for OpenTelemetryのゼロコード計装を利用し、CloudWatch Application Signalsで可視化することを想定しています。
作成されたアプリケーションに対してCloudWatch Synthetics Canaryにてモニタリングを行います。この際、CloudWatch SyntheticsとCloudWatch Application Signalsが連動しています。

## EC2ユーザーデータ

ユーザーデータでは以下のことを実装します。
・S3からJarファイルをダウンロード
・AWS Secrets Managerからデータベースへのアクセス情報を取得し、application.propertiesファイルに設定
・AWS Distro for OpenTelemetryのゼロコード計装Agentをインストールと必要な設定
・CloudWatch Agentのインストールとログ収集の設定
・systemdサービスとしてJavaアプリケーションを起動
