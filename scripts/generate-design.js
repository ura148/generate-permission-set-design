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

async function getCustomFieldsFromPackageXml() {
  const xmlContent = await fs.readFile("manifest/package.xml", "utf-8");
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name, jpath) => name === "members"
  });
  const result = parser.parse(xmlContent);

  const customFields = result.Package.types.find(
    (type) => type.name === "CustomField"
  );
  return customFields ? customFields.members : [];
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

async function getProfileMetadata(profileName) {
  const profilePath = `force-app/main/default/profiles/${profileName}.profile-meta.xml`;

  try {
    const xmlContent = await fs.readFile(profilePath, "utf-8");
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
    console.error(`Error reading profile metadata for ${profileName}:`, error);
    throw error;
  }
}

async function getObjectDescribe(objectName) {
  try {
    const describeData = await fs.readFile(
      `.describe_data/${objectName}_describe.json`,
      "utf-8"
    );
    return JSON.parse(describeData);
  } catch (error) {
    console.error(`Error reading describe data for ${objectName}:`, error);
    return null;
  }
}

async function generateObjectPermissionsTable(
  profileName,
  customObjects,
  metadata
) {
  let markdownContent = `# オブジェクト権限設計書

## プロファイル: ${metadata.Profile.label || profileName}

### オブジェクト権限の説明
- C: レコードの作成
- R: レコードの参照
- U: レコードの編集
- D: レコードの削除
- Va: すべて参照
- Ua: すべて変更
- Fa: すべての項目表示

### オブジェクト権限一覧(table data)
| オブジェクト名 | オブジェクトAPI名 | 権限 |
|:--|:--|:--|`;

  const objectRows = [];
  for (const objName of customObjects) {
    const objPermission = metadata.Profile.objectPermissions?.find(
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

    const objectDescribe = await getObjectDescribe(objName);
    const displayName = objectDescribe
      ? objectDescribe.label
      : objName.replace("__c", "");
    objectRows.push(`| ${displayName} | ${objName} | ${permissions} |`);
  }

  markdownContent += "\n" + objectRows.join("\n");
  return markdownContent;
}

async function getFieldLabel(objectDescribe, fieldName) {
  if (!objectDescribe || !objectDescribe.fields) return fieldName;
  // カスタム項目も標準項目も、完全一致で検索
  const field = objectDescribe.fields.find((f) => f.name === fieldName);
  if (!field) {
    console.error(`Field not found: ${fieldName}`);
    return fieldName;
  }
  console.log(`Found field ${fieldName} with label ${field.label}`);
  return field.label;
}

async function generateFieldPermissionsTable(
  profileName,
  customFields,
  metadata
) {
  let markdownContent = `# 項目権限設計書

## プロファイル: ${metadata.Profile.label || profileName}

### 項目権限の説明
- R: 参照可能
- RU: 参照・編集可能
- -: 権限なし

### 項目権限一覧(table data)
| オブジェクト名 | オブジェクトAPI名 | 項目名 | 項目API名 | 権限 |
|:--|:--|:--|:--|:--|`;

  for (const fieldFullName of customFields) {
    const [objName, fieldName] = fieldFullName.split(".");
    const objectDescribe = await getObjectDescribe(objName);
    const displayName = objectDescribe
      ? objectDescribe.label
      : objName.replace("__c", "");
    const fieldLabel = await getFieldLabel(objectDescribe, fieldName);
    const fieldPerm = metadata.Profile.fieldPermissions?.find(
      (p) => p.field === fieldFullName
    );

    let permission = "-";
    if (fieldPerm) {
      if (fieldPerm.readable && fieldPerm.editable) {
        permission = "RU";
      } else if (fieldPerm.readable) {
        permission = "R";
      }
    }
    markdownContent += `\n| ${displayName} | ${objName} | ${fieldLabel} | ${fieldName} | ${permission} |`;
  }

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

  // 各列の最大幅を計算
  const columnWidths = Array(headerCells).fill(0);
  const minColumnWidth = 150; // 最小列幅

  // テキストを測定するためのコンテキストを作成
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = "14px Arial";

  // 各セルの内容を測定して最大幅を更新
  for (const row of tableRows) {
    const cells = row
      .split("|")
      .filter((cell) => cell.trim())
      .map((cell) => cell.trim());

    cells.forEach((cell, index) => {
      if (index < headerCells) {
        const textWidth = measureCtx.measureText(cell).width + cellPadding * 2;
        columnWidths[index] = Math.max(
          columnWidths[index],
          textWidth,
          minColumnWidth
        );
      }
    });
  }

  const width =
    columnWidths.reduce((sum, width) => sum + width, 0) + padding * 2;
  const height = (tableRows.length - 1) * rowHeight + padding * 2;

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
          const textHeight = 14;
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

  const permissionSetsType = result.Package.types.find(
    (type) => type.name === "PermissionSet"
  );
  const permissionSets = permissionSetsType ? permissionSetsType.members : [];

  const profileType = result.Package.types.find(
    (type) => type.name === "Profile"
  );
  const profiles = profileType ? profileType.members : [];

  return { permissionSets, profiles };
}

async function createDesignFolder(permissionSetName, metadata, customFields) {
  const designPath = path.join(".design", "permissionsets", permissionSetName);

  try {
    await fs.access(designPath);
    console.log(`Folder already exists: ${designPath}`);
  } catch {
    await fs.mkdir(designPath, { recursive: true });
    console.log(`Created folder: ${designPath}`);
  }

  // Get custom objects from package.xml
  const customObjects = await getCustomObjectsFromPackageXml();

  // Generate and save object permissions
  const objectPermissions = await generateObjectPermissionsTable(
    permissionSetName,
    customObjects,
    metadata
  );
  const objectMdPath = path.join(designPath, "object-permissions.md");
  await fs.writeFile(objectMdPath, objectPermissions);
  console.log(`Created object permissions markdown file: ${objectMdPath}`);

  const objectImageBuffer = await generateImage(objectPermissions);
  if (objectImageBuffer) {
    const objectImgPath = path.join(designPath, "object-permissions.png");
    await fs.writeFile(objectImgPath, objectImageBuffer);
    console.log(`Created object permissions image file: ${objectImgPath}`);
  }

  // Generate and save field permissions
  const fieldPermissions = await generateFieldPermissionsTable(
    permissionSetName,
    customFields,
    metadata
  );
  const fieldMdPath = path.join(designPath, "field-permissions.md");
  await fs.writeFile(fieldMdPath, fieldPermissions);
  console.log(`Created field permissions markdown file: ${fieldMdPath}`);

  const fieldImageBuffer = await generateImage(fieldPermissions);
  if (fieldImageBuffer) {
    const fieldImgPath = path.join(designPath, "field-permissions.png");
    await fs.writeFile(fieldImgPath, fieldImageBuffer);
    console.log(`Created field permissions image file: ${fieldImgPath}`);
  }
}

async function generateAllDesigns(permissionSets, customFields) {
  for (const ps of permissionSets) {
    const metadata = await getPermissionSetMetadata(ps);
    await createDesignFolder(ps, metadata, customFields);
  }
}

async function generateAllSummary(permissionSets, profiles, customFields) {
  const allPath = path.join(".design", "permissionsets", "all");
  try {
    await fs.access(allPath);
  } catch {
    await fs.mkdir(allPath, { recursive: true });
    console.log(`Created folder: ${allPath}`);
  }

  // Get custom objects from package.xml
  const customObjects = await getCustomObjectsFromPackageXml();

  // Generate object permissions summary
  let objectMarkdownContent = `# オブジェクト権限設計書

### オブジェクト権限の説明
- C: レコードの作成
- R: レコードの参照
- U: レコードの編集
- D: レコードの削除
- Va: すべて参照
- Ua: すべて変更
- Fa: すべての項目表示

### オブジェクト権限一覧(table data)
| オブジェクト名 | オブジェクトAPI名`;

  // 各権限セット、プロファイルのラベルを取得して使用
  for (const ps of permissionSets) {
    const metadata = await getPermissionSetMetadata(ps);
    const label = metadata.PermissionSet.label || ps;
    objectMarkdownContent += ` | ${label}`;
  }
  for (const profile of profiles) {
    const metadata = await getProfileMetadata(profile);
    const label = metadata.Profile.label || profile;
    objectMarkdownContent += ` | ${label}`;
  }
  objectMarkdownContent += " |\n|:--|:--";
  permissionSets.forEach(() => {
    objectMarkdownContent += "|:--";
  });
  profiles.forEach(() => {
    objectMarkdownContent += "|:--";
  });
  objectMarkdownContent += "|";

  for (const objName of customObjects) {
    const objectDescribe = await getObjectDescribe(objName);
    const displayName = objectDescribe
      ? objectDescribe.label
      : objName.replace("__c", "");
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

    for (const profile of profiles) {
      const metadata = await getProfileMetadata(profile);
      const objPermission = metadata.Profile.objectPermissions?.find(
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
    objectMarkdownContent += row;
  }

  // Save object permissions summary
  const objectMdPath = path.join(allPath, "object-permissions.md");
  await fs.writeFile(objectMdPath, objectMarkdownContent);
  console.log(
    `Created object permissions summary markdown file: ${objectMdPath}`
  );

  const objectImageBuffer = await generateImage(objectMarkdownContent);
  if (objectImageBuffer) {
    const objectImgPath = path.join(allPath, "object-permissions.png");
    await fs.writeFile(objectImgPath, objectImageBuffer);
    console.log(
      `Created object permissions summary image file: ${objectImgPath}`
    );
  }

  // Generate field permissions summary
  let fieldMarkdownContent = `# 項目権限設計書

### 項目権限の説明
- R: 参照可能
- RU: 参照・編集可能
- -: 権限なし

### 項目権限一覧(table data)
| オブジェクト名 | オブジェクトAPI名 | 項目名 | 項目API名`;

  // 各権限セット、プロファイルのラベルを取得して使用
  for (const ps of permissionSets) {
    const metadata = await getPermissionSetMetadata(ps);
    const label = metadata.PermissionSet.label || ps;
    fieldMarkdownContent += ` | ${label}`;
  }
  for (const profile of profiles) {
    const metadata = await getProfileMetadata(profile);
    const label = metadata.Profile.label || profile;
    fieldMarkdownContent += ` | ${label}`;
  }
  fieldMarkdownContent += " |\n|:--|:--|:--|:--";
  permissionSets.forEach(() => {
    fieldMarkdownContent += "|:--";
  });
  profiles.forEach(() => {
    fieldMarkdownContent += "|:--";
  });
  fieldMarkdownContent += "|";

  for (const fieldFullName of customFields) {
    const [objName, fieldName] = fieldFullName.split(".");
    const objectDescribe = await getObjectDescribe(objName);
    const displayName = objectDescribe
      ? objectDescribe.label
      : objName.replace("__c", "");
    const fieldLabel = await getFieldLabel(objectDescribe, fieldName);
    let row = `\n| ${displayName} | ${objName} | ${fieldLabel} | ${fieldName}`;

    for (const ps of permissionSets) {
      const metadata = await getPermissionSetMetadata(ps);
      const fieldPerm = metadata.PermissionSet.fieldPermissions?.find(
        (p) => p.field === fieldFullName
      );

      let permission = "-";
      if (fieldPerm) {
        if (fieldPerm.readable && fieldPerm.editable) {
          permission = "RU";
        } else if (fieldPerm.readable) {
          permission = "R";
        }
      }
      row += ` | ${permission}`;
    }

    for (const profile of profiles) {
      const metadata = await getProfileMetadata(profile);
      const fieldPerm = metadata.Profile.fieldPermissions?.find(
        (p) => p.field === fieldFullName
      );

      let permission = "-";
      if (fieldPerm) {
        if (fieldPerm.readable && fieldPerm.editable) {
          permission = "RU";
        } else if (fieldPerm.readable) {
          permission = "R";
        }
      }
      row += ` | ${permission}`;
    }
    row += " |";
    fieldMarkdownContent += row;
  }

  // Save field permissions summary
  const fieldMdPath = path.join(allPath, "field-permissions.md");
  await fs.writeFile(fieldMdPath, fieldMarkdownContent);
  console.log(
    `Created field permissions summary markdown file: ${fieldMdPath}`
  );

  const fieldImageBuffer = await generateImage(fieldMarkdownContent);
  if (fieldImageBuffer) {
    const fieldImgPath = path.join(allPath, "field-permissions.png");
    await fs.writeFile(fieldImgPath, fieldImageBuffer);
    console.log(
      `Created field permissions summary image file: ${fieldImgPath}`
    );
  }
}

async function main() {
  try {
    const { permissionSets, profiles } =
      await getPermissionSetsFromPackageXml();

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
          })),
          ...profiles.map((profile) => ({
            name: profile,
            value: profile
          }))
        ]
      }
    ]);

    const customFields = await getCustomFieldsFromPackageXml();

    if (selected === "All") {
      await generateAllDesigns(permissionSets, customFields);
    } else if (selected === "All summary") {
      await generateAllSummary(permissionSets, profiles, customFields);
    } else {
      // Differentiate between PermissionSets and Profiles
      if (permissionSets.includes(selected)) {
        const metadata = await getPermissionSetMetadata(selected);
        await createDesignFolder(selected, metadata, customFields);
      } else {
        // Handle Profiles
        try {
          const metadata = await getProfileMetadata(selected);
          const designPath = path.join(".design", "profiles", selected);

          try {
            await fs.access(designPath);
            console.log(`Folder already exists: ${designPath}`);
          } catch {
            await fs.mkdir(designPath, { recursive: true });
            console.log(`Created folder: ${designPath}`);
          }

          // Get custom objects from package.xml
          const customObjects = await getCustomObjectsFromPackageXml();

          // Generate and save object permissions
          const objectPermissions = await generateObjectPermissionsTable(
            selected,
            customObjects,
            metadata
          );
          const objectMdPath = path.join(designPath, "object-permissions.md");
          await fs.writeFile(objectMdPath, objectPermissions);
          console.log(
            `Created object permissions markdown file: ${objectMdPath}`
          );

          const objectImageBuffer = await generateImage(objectPermissions);
          if (objectImageBuffer) {
            const objectImgPath = path.join(
              designPath,
              "object-permissions.png"
            );
            await fs.writeFile(objectImgPath, objectImageBuffer);
            console.log(
              `Created object permissions image file: ${objectImgPath}`
            );
          }

          // Generate and save field permissions
          const fieldPermissions = await generateFieldPermissionsTable(
            selected,
            customFields,
            metadata
          );
          const fieldMdPath = path.join(designPath, "field-permissions.md");
          await fs.writeFile(fieldMdPath, fieldPermissions);
          console.log(
            `Created field permissions markdown file: ${fieldMdPath}`
          );

          const fieldImageBuffer = await generateImage(fieldPermissions);
          if (fieldImageBuffer) {
            const fieldImgPath = path.join(designPath, "field-permissions.png");
            await fs.writeFile(fieldImgPath, fieldImageBuffer);
            console.log(
              `Created field permissions image file: ${fieldImgPath}`
            );
          }
        } catch (error) {
          console.error(
            `Error generating design for profile ${selected}:`,
            error
          );
        }
      }
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
