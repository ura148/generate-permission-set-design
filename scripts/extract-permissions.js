import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import inquirer from "inquirer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const basePermissionsetsPath = path.resolve(
  __dirname,
  "../.design/permissionsets"
);

async function extractTableData() {
  const folderChoices = fs
    .readdirSync(basePermissionsetsPath, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  const folderAnswer = await inquirer.prompt([
    {
      type: "list",
      name: "selectedFolder",
      message: "Select a folder:",
      choices: folderChoices
    }
  ]);

  const selectedFolderPath = path.resolve(
    basePermissionsetsPath,
    folderAnswer.selectedFolder
  );

  const fileChoices = fs
    .readdirSync(selectedFolderPath)
    .filter((file) => file.endsWith(".md"));

  const fileAnswer = await inquirer.prompt([
    {
      type: "list",
      name: "selectedFile",
      message: "Select a file:",
      choices: fileChoices
    }
  ]);

  const markdownFilePath = path.resolve(
    selectedFolderPath,
    fileAnswer.selectedFile
  );

  fs.readFile(markdownFilePath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading the markdown file:", err);
      process.exit(1);
      return;
    }

    // Regular expression to match the table
    const tableRegex = /\|(.*)\|\n\|:--+(?:\|:--+)+\|\n((?:\|.*\|\n?)+)/;
    const tableMatch = data.match(tableRegex);

    console.log("data:", data);
    console.log("tableMatch:", tableMatch);

    if (!tableMatch) {
      console.error("No table found in the markdown file.");
      process.exit(1);
      return;
    }

    const headerRow = tableMatch[1].trim();
    const headerCells = headerRow
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
    const outputHeader = headerCells.join("\t") + "\n";

    const tableData = tableMatch[2].trim();
    const rows = tableData
      .trim()
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter((row) => row.startsWith("|"))
      .filter((row) => !row.includes("|:--"));
    const filteredRows = rows.filter((row) => row.length > 0);
    console.log("rows:", filteredRows);

    let output = outputHeader;

    rows.forEach((row) => {
      const cells = row
        .split("|")
        .map((cell) => cell.trim())
        .slice(1, -1);
      output += cells.join("\t") + "\n";
    });

    // Copy to clipboard using pbcopy
    exec(`echo "${output}" | pbcopy`, (error, stdout, stderr) => {
      if (error) {
        console.error("Error copying to clipboard:", error);
        process.exit(1);
        return;
      }
      console.log("Table data copied to clipboard!");
      console.log("Output:", output); // Log the output
    });
  });
}

extractTableData();
