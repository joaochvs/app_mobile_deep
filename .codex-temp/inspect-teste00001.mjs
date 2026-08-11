import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const files = process.argv.slice(2);
for (const file of files) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  const sheets = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 4000 });
  const matches = await workbook.inspect({
    kind: "match",
    searchTerm: "teste00001",
    options: { useRegex: false, maxResults: 20 },
    maxChars: 10000,
  });
  process.stdout.write(`FILE: ${file}\nSHEETS:\n${sheets.ndjson}\nMATCHES:\n${matches.ndjson}\n`);
}
