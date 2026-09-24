/**
 * 把 xlsx 的全部工作表内容打印出来，用于查看外部表格。
 *
 *   pnpm exec vite-node tools/dump-xlsx.mts <路径>
 */

import ExcelJS from 'exceljs';

const path = process.argv[2];
if (path === undefined) throw new Error('用法: dump-xlsx.mts <xlsx路径> [表名过滤] [最多行数]');
const filter = process.argv[3];
const maxRows = process.argv[4] === undefined ? 12 : Number(process.argv[4]);

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(path);

console.log(`名称: ${workbook.worksheets.map((ws) => ws.name).join(' | ')}`);

for (const sheet of workbook.worksheets) {
  if (filter !== undefined && !sheet.name.includes(filter)) continue;
  console.log('');
  console.log(`========== 【${sheet.name}】 ${sheet.rowCount} 行 x ${sheet.columnCount} 列 ==========`);
  let printed = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (printed >= maxRows) return;
    const values: string[] = [];
    for (let col = 1; col <= sheet.columnCount; col += 1) {
      const cell = row.getCell(col);
      const raw = cell.value;
      let text = '';
      if (raw === null || raw === undefined) text = '';
      else if (typeof raw === 'object' && 'richText' in raw) {
        text = (raw as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join('');
      } else if (typeof raw === 'object' && 'text' in raw) {
        text = String((raw as { text: unknown }).text);
      } else if (typeof raw === 'object' && 'result' in raw) {
        text = String((raw as { result: unknown }).result);
      } else text = String(raw);
      values.push(text.replace(/\s+/g, ' ').trim());
    }
    while (values.length > 0 && values[values.length - 1] === '') values.pop();
    if (values.length === 0) return;
    printed += 1;
    console.log(`[${rowNumber}] ${values.join(' | ')}`);
  });
  if (sheet.rowCount > maxRows) console.log(`  …（共 ${sheet.rowCount} 行，只显示前 ${maxRows} 行）`);
}
