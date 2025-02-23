#!/usr/bin/env node
const jsforce = require("jsforce");
const fs = require("fs");
const path = require("path");
const { checkbox } = require("@inquirer/prompts");

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

    // 組織の全オブジェクト一覧を取得
    console.log("オブジェクト一覧を取得中...");
    const { sobjects } = await conn.describeGlobal();

    // オブジェクトを標準とカスタムに分類
    const standardObjects = sobjects
      .filter((obj) => !obj.custom)
      .map((obj) => ({
        name: obj.name,
        label: obj.label,
        type: "標準"
      }));

    const customObjects = sobjects
      .filter((obj) => obj.custom)
      .map((obj) => ({
        name: obj.name,
        label: obj.label,
        type: "カスタム"
      }));

    // オブジェクトを選択するプロンプトを表示（複数選択可能）
    const selectedObjects = await checkbox({
      message:
        "describeを実行するオブジェクトを選択してください (Spaceキーで選択/解除):",
      choices: [
        { name: "=== 標準オブジェクト ===", value: "", disabled: true },
        ...standardObjects.map((obj) => ({
          name: `${obj.label} (${obj.name})`,
          value: obj.name
        })),
        { name: "=== カスタムオブジェクト ===", value: "", disabled: true },
        ...customObjects.map((obj) => ({
          name: `${obj.label} (${obj.name})`,
          value: obj.name
        }))
      ],
      pageSize: 20
    });

    // 選択された各オブジェクトに対してdescribe情報を取得
    for (const objectName of selectedObjects) {
      console.log(`${objectName}オブジェクトのdescribe情報を取得中...`);
      const meta = await conn.sobject(objectName).describe();

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const outputPath = path.join(targetDir, `${objectName}_describe.json`);
      fs.writeFileSync(outputPath, JSON.stringify(meta, null, 2), "utf8");
      console.log(
        `${objectName}のdescribe情報を ${outputPath} に保存しました。`
      );
    }

    console.log("すべての処理が完了しました。");
  } catch (err) {
    console.error("エラーが発生しました:", err);
    process.exit(1);
  }
})();
