# 権限セット設計書ジェネレーター

Salesforce DXプロジェクトで、権限セットの設計書を生成・管理するためのツールです。

## セットアップ

1. このリポジトリをクローンします
2. 依存関係をインストールします：

```bash
npm install
```

3. 環境変数を設定します：
   - `.env.example` を `.env` にコピーします
   - `.env` 内の値をあなたのSalesforce認証情報で更新します

```bash
cp .env.example .env
```

4. Salesforce組織で認証を行います：

```bash
sf org login web --alias {yourOrgAliasName}
```

## 環境変数

| 変数名            | 説明                                                               |
| ----------------- | ------------------------------------------------------------------ |
| SF_USERNAME       | Salesforceのユーザー名                                             |
| SF_PASSWORD       | Salesforceのパスワード                                             |
| SF_SECURITY_TOKEN | Salesforceのセキュリティトークン                                   |
| SF_LOGIN_URL      | SalesforceログインURL（デフォルト: https://login.salesforce.com/） |

## 利用可能なコマンド

### オブジェクト情報の取得

```bash
npm run sf:describe:object
```

Before running this command:

1. 環境変数（.env）に正しい認証情報が設定されていることを確認
2. `.describe_data`ディレクトリが作成されていない場合は自動的に作成されます

このコマンドの機能：

- Salesforce組織内のオブジェクトに関する詳細なメタデータ情報を取得
- 対話型CLIでオブジェクトを選択可能
- package.xmlからオブジェクトを自動選択するオプション
- オブジェクト情報を`.describe_data`ディレクトリにJSONファイルとして保存
- 権限セット設計生成の前提条件として必要

### 権限セット設計の生成

```bash
npm run sf:generate:design
```

Before running this command:

1. `npm run sf:describe:object`を実行して、オブジェクト情報を取得していること
2. `.describe_data`ディレクトリに必要なJSONファイルが存在すること
3. Salesforce組織に接続されていることを確認（必要に応じて`sf login org`を実行）

このコマンドの機能：

- オブジェクト情報に基づいて権限セット設計を生成
- 権限セットのメタデータがローカルに存在しない場合、Salesforce組織から自動的に取得
- `.design`ディレクトリに設計ドキュメントを作成
- 対話型CLIで以下の設定をガイド：
  - オブジェクト権限の設定
- 複数の出力形式をサポート：
  - 個別の権限セットを選択して設計書生成
  - すべての権限セットの設計書生成
  - すべての権限セットの一覧にまとめた上で設計書生成
- 設計した設計書に含まれる表は自動でPngを生成

## 参考リンク

- [Salesforce Extensions ドキュメント](https://developer.salesforce.com/tools/vscode/)
- [Salesforce CLI セットアップガイド](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm)
- [Salesforce DX 開発者ガイド](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_intro.htm)
- [Salesforce CLI コマンドリファレンス](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference.htm)
