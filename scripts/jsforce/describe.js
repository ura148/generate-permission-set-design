#!/usr/bin/env node
const jsforce = require("jsforce");
const fs = require("fs");
const path = require("path");
// プロジェクトルートの.envファイルから環境変数をロード
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

// Salesforce認証情報（環境変数から取得）
const username = process.env.SF_USERNAME;
const password = process.env.SF_PASSWORD;
const securityToken = process.env.SF_SECURITY_TOKEN || "";
const loginUrl = process.env.SF_LOGIN_URL || "https://login.salesforce.com";

// コマンドライン引数から出力先ディレクトリを取得（指定がなければ'./output'を使用）
const targetDir = process.argv[2] || "./output";

if (!username || !password || !securityToken) {
  console.error(
    "環境変数 SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN を設定してください。"
  );
  process.exit(1);
}

const conn = new jsforce.Connection({ loginUrl });

(async () => {
  try {
    console.log("Salesforceにログイン中...");
    const userInfo = await conn.login(username, password + securityToken);
    console.log(`ログイン成功: ユーザID ${userInfo.id}`);

    console.log("Accountオブジェクトのdescribe情報を取得中...");
    const meta = await conn.sobject("Account").describe();

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const outputPath = path.join(targetDir, "Account_describe.json");
    fs.writeFileSync(outputPath, JSON.stringify(meta, null, 2), "utf8");
    console.log(
      `取引先(Account)のdescribe情報を ${outputPath} に保存しました。`
    );
  } catch (err) {
    console.error("エラーが発生しました:", err);
  }
})();
