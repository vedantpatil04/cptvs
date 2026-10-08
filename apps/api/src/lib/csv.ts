/** UTF-8 byte-order mark, so spreadsheet apps detect the encoding. */
const BOM = '\uFEFF';

/** Characters that make spreadsheet apps treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One RFC 4180 cell. Text that could be interpreted as a spreadsheet formula
 * is prefixed with an apostrophe (CSV injection protection).
 */
export const csvCell = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV document with a UTF-8 BOM so spreadsheet apps detect the encoding. */
export const toCsv = (
  header: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string => `${BOM}${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** Integer paise as a rupee amount with two decimals, e.g. 2000 → "20.00". */
export const rupees = (paise: number | null | undefined): string =>
  paise === null || paise === undefined ? '' : (paise / 100).toFixed(2);
