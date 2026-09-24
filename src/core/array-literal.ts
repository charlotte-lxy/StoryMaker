/**
 * Unreal 数组字面量的读写。
 *
 * 导出时把多值列（条件列表、结果列表、指令列表）写成 ("a","b","c") 的形式，
 * 样例里空列表写的是空单元格，而不是 "()"。
 */

/**
 * 生成数组字面量。空列表返回空字符串。
 */
export function formatArrayLiteral(items: readonly string[]): string {
  if (items.length === 0) return '';
  return '(' + items.map((item) => '"' + item.replace(/"/g, '""') + '"').join(',') + ')';
}

/** 解析 Unreal 数组字面量，容忍空值与未加括号的形式 */
export function parseArrayLiteral(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '()') return [];

  const inner =
    trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  if (inner.trim() === '') return [];

  return inner
    .split(',')
    .map((part) => part.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/""/g, '"'))
    .filter((part) => part !== '');
}
