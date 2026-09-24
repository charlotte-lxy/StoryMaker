/**
 * CSV 序列化。
 *
 * 目标格式的要求：
 *   - UTF-8 带 BOM（保证 Excel 双击不乱码，也是现有三个样例中两个的编码）
 *   - CRLF 换行
 *   - 仅在必要时加引号（RFC 4180），而不是像 Excel 那样给所有文本都套引号
 */

export const UTF8_BOM = '\uFEFF';

/** 字段含逗号、引号或换行时才加引号，内部引号翻倍 */
export function escapeCsvField(value: string): string {
  if (value === '') return '';
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return '';
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + '\r\n';
}

export function withBom(text: string): string {
  return UTF8_BOM + text;
}

export function withoutBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/** 解析 RFC 4180 CSV 文本为二维数组，处理引号内的逗号与换行 */
export function parseCsv(text: string): string[][] {
  const src = withoutBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // 收尾：仅当最后一行有内容时才提交，避免产生尾部空行
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
