import inquirer from "inquirer";
import { XMLParser } from "fast-xml-parser";
import fs from "fs/promises";
import path from "path";
import { createCanvas } from "canvas";

async function getCustomObjectsFromPackageXml() {
  const xmlContent = await fs.readFile("manifest/package.xml", "utf-8");
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name, jpath) => name === "members"
  });
  const result = parser.parse(xmlContent);

  const customObjects = result.Package.types.find(
    (type) => type.name === "CustomObject"
  );
  return customObjects ? customObjects.members : [];
}

async function getPermissionSetMetadata(permissionSetName) {
  const xmlContent = await fs.readFile(
    `force-app/main/default/permissionsets/${permissionSetName}.permissionset-meta.xml`,
    "utf-8"
  );
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name) =>
      [
        "fieldPermissions",
        "objectPermissions",
        "recordTypeVisibilities",
        "tabSettings"
      ].includes(name)
  });
  return parser.parse(xmlContent);
}

async function generateMarkdownTable(permissionSetName, customObjects) {
  const metadata = await getPermissionSetMetadata(permissionSetName);

  let markdownContent = `# オブジェクト権限設計書

## 権限セット: ${permissionSetName}

### 権限の説明
- C: レコードの作成
- R: レコードの参照
- U: レコードの編集
- D: レコードの削除
- Va: すべて参照
- Ua: すべて変更
- Fa: すべての項目表示

### オブジェクト権限一覧

| オブジェクト名 | オブジェクトAPI名 | 権限 
|:--|:--|:--`;

  const rows = customObjects.map((objName) => {
    const objPermission = metadata.PermissionSet.objectPermissions?.find(
      (p) => p.object === objName
    );
    let permissions = "-";

    if (objPermission) {
      permissions = "";
      if (objPermission.allowCreate) permissions += "C";
      if (objPermission.allowRead) permissions += "R";
      if (objPermission.allowEdit) permissions += "U";
      if (objPermission.allowDelete) permissions += "D";
      if (objPermission.viewAllRecords) permissions += "Va";
      if (objPermission.modifyAllRecords) permissions += "Ua";
      if (objPermission.viewAllFields) permissions += "Fa";
      if (permissions === "") permissions = "-";
    }

    // カスタムオブジェクトの表示名は__cを除いて表示
    const displayName = objName.replace("__c", "");

    return `| ${displayName} | ${objName} | ${permissions} `;
  });

  markdownContent += "\n" + rows.join("\n");
  return markdownContent;
}

async function generateImage(markdownContent) {
  // テーブル部分のみを抽出
  const lines = markdownContent.split("\n");
  const tableStartIndex = lines.findIndex((line) =>
    line.startsWith("| オブジェクト名")
  );
  if (tableStartIndex === -1) return null;

  const tableLines = lines.slice(tableStartIndex);
  const tableRows = tableLines.filter((line) => line.startsWith("|"));

  // キャンバスのサイズを設定（テーブルの行数に応じて高さを調整）
  const width = 600;
  const rowHeight = 30;
  const padding = 20;
  const height = tableRows.length * rowHeight + padding * 2;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // 背景を白に設定
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // テーブルの描画
  let y = padding;
  let isHeader = true;

  for (const line of tableRows) {
    if (line.includes(":-")) continue;

    const cells = line
      .split("|")
      .filter((cell) => cell.trim())
      .map((cell) => cell.trim());

    if (cells.length === 3) {
      // セルの背景色
      if (isHeader) {
        ctx.fillStyle = "#f0f0f0";
        ctx.fillRect(padding, y - 5, width - padding * 2, rowHeight);
      }

      // テキストの描画
      ctx.fillStyle = "#000000";
      ctx.font = isHeader ? "bold 14px Arial" : "14px Arial";

      const columnWidths = [180, 220, 100];
      let x = padding;

      cells.forEach((cell, index) => {
        ctx.fillText(cell, x + 10, y + 15);
        x += columnWidths[index];
      });

      // セルの罫線
      ctx.strokeStyle = "#cccccc";
      ctx.beginPath();

      // 横線
      ctx.moveTo(padding, y + rowHeight - 5);
      ctx.lineTo(width - padding, y + rowHeight - 5);

      // 縦線
      x = padding;
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + rowHeight - 5);
      cells.forEach((_, index) => {
        x += columnWidths[index];
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x, y + rowHeight - 5);
      });

      ctx.stroke();

      y += rowHeight;
      isHeader = false;
    }
  }

  return canvas.toBuffer();
}

async function getPermissionSetsFromPackageXml() {
  const xmlContent = await fs.readFile("manifest/package.xml", "utf-8");
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name, jpath) => name === "members"
  });
  const result = parser.parse(xmlContent);

  const permissionSets = result.Package.types.find(
    (type) => type.name === "PermissionSet"
  );
  return permissionSets ? permissionSets.members : [];
}

async function createDesignFolder(permissionSetName, markdownContent) {
  const designPath = path.join(".design", "permissionsets", permissionSetName);
  const designFilePath = path.join(designPath, "object-permissions.md");
  const imageFilePath = path.join(designPath, "object-permissions.png");

  try {
    await fs.access(designPath);
    console.log(`Folder already exists: ${designPath}`);
  } catch {
    await fs.mkdir(designPath, { recursive: true });
    console.log(`Created folder: ${designPath}`);
  }

  // Save markdown file
  await fs.writeFile(designFilePath, markdownContent);
  console.log(`Created markdown file: ${designFilePath}`);

  // Generate and save image
  const imageBuffer = await generateImage(markdownContent);
  if (imageBuffer) {
    await fs.writeFile(imageFilePath, imageBuffer);
    console.log(`Created image file: ${imageFilePath}`);
  }
}

async function generateAllDesigns(permissionSets, customObjects) {
  for (const ps of permissionSets) {
    const markdownContent = await generateMarkdownTable(ps, customObjects);
    await createDesignFolder(ps, markdownContent);
  }
}

async function generateAllSummary(permissionSets, customObjects) {
  const allPath = path.join(".design", "permissionsets", "all");
  try {
    await fs.access(allPath);
  } catch {
    await fs.mkdir(allPath, { recursive: true });
    console.log(`Created folder: ${allPath}`);
  }

  let markdownContent = `# オブジェクト権限設計書

### 権限の説明
- C: レコードの作成
- R: レコードの参照
- U: レコードの編集
- D: レコードの削除
- Va: すべて参照
- Ua: すべて変更
- Fa: すべての項目表示

### オブジェクト権限一覧

| オブジェクト名 | オブジェクトAPI名`;

  // Add permission set names as columns
  permissionSets.forEach((ps) => {
    markdownContent += ` | ${ps}`;
  });
  markdownContent += " |\n|:--|:--";
  permissionSets.forEach(() => {
    markdownContent += "|:--";
  });
  markdownContent += "|";

  // Get permissions for each object across all permission sets
  for (const objName of customObjects) {
    const displayName = objName.replace("__c", "");
    let row = `\n| ${displayName} | ${objName}`;

    for (const ps of permissionSets) {
      const metadata = await getPermissionSetMetadata(ps);
      const objPermission = metadata.PermissionSet.objectPermissions?.find(
        (p) => p.object === objName
      );

      let permissions = "-";
      if (objPermission) {
        permissions = "";
        if (objPermission.allowCreate) permissions += "C";
        if (objPermission.allowRead) permissions += "R";
        if (objPermission.allowEdit) permissions += "U";
        if (objPermission.allowDelete) permissions += "D";
        if (objPermission.viewAllRecords) permissions += "Va";
        if (objPermission.modifyAllRecords) permissions += "Ua";
        if (objPermission.viewAllFields) permissions += "Fa";
        if (permissions === "") permissions = "-";
      }
      row += ` | ${permissions}`;
    }
    row += " |";
    markdownContent += row;
  }

  const designFilePath = path.join(allPath, "object-permissions.md");
  await fs.writeFile(designFilePath, markdownContent);
  console.log(`Created summary markdown file: ${designFilePath}`);

  const imageBuffer = await generateImage(markdownContent);
  if (imageBuffer) {
    const imageFilePath = path.join(allPath, "object-permissions.png");
    await fs.writeFile(imageFilePath, imageBuffer);
    console.log(`Created summary image file: ${imageFilePath}`);
  }
}

async function main() {
  try {
    const permissionSets = await getPermissionSetsFromPackageXml();

    if (!Array.isArray(permissionSets) || permissionSets.length === 0) {
      console.error("No permission sets found in package.xml");
      process.exit(1);
    }

    const { selected } = await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: "Select a permission set to generate design:",
        choices: [
          {
            name: "All - Generate designs for all permission sets",
            value: "All"
          },
          {
            name: "All summary - Generate combined summary table",
            value: "All summary"
          },
          ...permissionSets.map((ps) => ({
            name: ps,
            value: ps
          }))
        ]
      }
    ]);

    const customObjects = await getCustomObjectsFromPackageXml();

    if (selected === "All") {
      await generateAllDesigns(permissionSets, customObjects);
    } else if (selected === "All summary") {
      await generateAllSummary(permissionSets, customObjects);
    } else {
      const markdownContent = await generateMarkdownTable(
        selected,
        customObjects
      );
      await createDesignFolder(selected, markdownContent);
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
