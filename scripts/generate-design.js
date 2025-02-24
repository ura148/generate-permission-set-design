import inquirer from "inquirer";
import { XMLParser } from "fast-xml-parser";
import fs from "fs/promises";
import path from "path";
import { createCanvas } from "canvas";
import { execSync } from "child_process";

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

async function retrievePermissionSet(permissionSetName) {
  console.log(
    `Retrieving permission set ${permissionSetName} from Salesforce...`
  );
  try {
    // Create a temporary package.xml for retrieving the permission set
    const tempPackageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>${permissionSetName}</members>
        <name>PermissionSet</name>
    </types>
    <version>59.0</version>
</Package>`;

    const tempDir = ".temp";
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, "package.xml"), tempPackageXml);

    // Execute SFDX retrieve command
    execSync(`sf project retrieve start -x ${tempDir}/package.xml`, {
      stdio: "inherit"
    });

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    console.log(`Successfully retrieved permission set ${permissionSetName}`);
    return true;
  } catch (error) {
    console.error(`Error retrieving permission set: ${error.message}`);
    throw error;
  }
}

async function getPermissionSetMetadata(permissionSetName) {
  const permissionSetPath = `force-app/main/default/permissionsets/${permissionSetName}.permissionset-meta.xml`;

  try {
    const xmlContent = await fs.readFile(permissionSetPath, "utf-8");
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
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(
        `Permission set metadata not found. Retrieving from Salesforce...`
      );
      await retrievePermissionSet(permissionSetName);
      // Try reading the file again after retrieval
      const xmlContent = await fs.readFile(permissionSetPath, "utf-8");
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
    throw error;
  }
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
    line.includes("| オブジェクト名 |")
  );
  if (tableStartIndex === -1) return null;

  const tableLines = lines.slice(tableStartIndex);
  const tableRows = tableLines.filter((line) => line.startsWith("|"));

  // ヘッダー行から列数を取得
  const headerCells = tableRows[0]
    .split("|")
    .filter((cell) => cell.trim()).length;

  // キャンバスのサイズを設定
  const cellPadding = 10;
  const rowHeight = 40;
  const padding = 20;

  // 列幅を設定
  const columnWidths = [
    200, // オブジェクト名
    250, // オブジェクトAPI名
    ...Array(headerCells - 2).fill(150) // 残りの列は固定幅
  ];

  const width =
    columnWidths.reduce((sum, width) => sum + width, 0) + padding * 2;
  const height = (tableRows.length - 1) * rowHeight + padding * 2; // 区切り行を除外

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // 背景を白に設定
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // グリッド線の色を設定
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 1;

  // テーブルの描画
  let y = padding;
  let isHeader = true;
  let rowIndex = 0;

  for (const line of tableRows) {
    // 区切り行をスキップ
    if (line.includes(":-")) continue;

    const cells = line
      .split("|")
      .filter((cell) => cell.trim())
      .map((cell) => cell.trim());

    if (cells.length >= 2) {
      // ヘッダー行の背景
      if (isHeader) {
        ctx.fillStyle = "#f0f0f0";
        ctx.fillRect(padding, y, width - padding * 2, rowHeight);
      }

      // セルの描画
      let x = padding;
      cells.forEach((cell, index) => {
        if (index < columnWidths.length) {
          const cellWidth = columnWidths[index];

          // セルの背景と境界線
          ctx.strokeRect(x, y, cellWidth, rowHeight);

          // テキストの描画
          ctx.fillStyle = "#000000";
          ctx.font = isHeader ? "bold 14px Arial" : "14px Arial";

          // テキストの省略処理
          const maxWidth = cellWidth - cellPadding * 2;
          let displayText = cell;
          if (ctx.measureText(cell).width > maxWidth) {
            while (
              ctx.measureText(displayText + "...").width > maxWidth &&
              displayText.length > 0
            ) {
              displayText = displayText.slice(0, -1);
            }
            displayText += "...";
          }

          // テキストを縦方向中央に配置
          const textHeight = 14; // フォントサイズと同じ
          const textY = y + (rowHeight + textHeight) / 2;

          ctx.fillText(displayText, x + cellPadding, textY);
          x += cellWidth;
        }
      });

      y += rowHeight;
      isHeader = false;
      rowIndex++;
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
