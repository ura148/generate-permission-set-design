import inquirer from "inquirer";
import { XMLParser } from "fast-xml-parser";
import fs from "fs/promises";
import path from "path";

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

| オブジェクト名 | オブジェクトAPI名 | 権限 |
|:--|:--|:--|`;

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

    return `| ${displayName} | ${objName} | ${permissions} |`;
  });

  markdownContent += "\n" + rows.join("\n");
  return markdownContent;
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

  try {
    await fs.access(designPath);
    console.log(`Folder already exists: ${designPath}`);
  } catch {
    await fs.mkdir(designPath, { recursive: true });
    console.log(`Created folder: ${designPath}`);
  }

  await fs.writeFile(designFilePath, markdownContent);
  console.log(`Created markdown file: ${designFilePath}`);
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
        choices: permissionSets.map((ps) => ({
          name: ps,
          value: ps
        }))
      }
    ]);

    const customObjects = await getCustomObjectsFromPackageXml();
    const markdownContent = await generateMarkdownTable(
      selected,
      customObjects
    );
    await createDesignFolder(selected, markdownContent);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
