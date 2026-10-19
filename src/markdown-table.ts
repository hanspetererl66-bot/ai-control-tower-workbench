/** Helpers for tables in chat answers: numeric columns are right-aligned, dates and ids are not. */

const DATE = /^(\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})$/;
const NUMBER = /^[-+−–]?\s?(?:[€$£]\s?)?\d[\d.,'’\s]*(?:\s?(?:%|€|\$|£|EUR|USD|h|min|d|Tage?|k|M|Mio\.?|Mrd\.?|T€|TEUR))?$/i;

export function isNumericCell(text: string): boolean {
  const t = text.trim();
  if (!t || DATE.test(t)) return false;
  return NUMBER.test(t);
}

export const isUnbreakable = (text: string): boolean => {
  const t = text.trim();
  return t.length > 0 && t.length <= 24 && !/\s/.test(t);
};

/** Marks a column as numeric when every non-empty body cell in it is a number. */
export function alignNumericColumns(root: HTMLElement): void {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const columns = Math.max(0, ...Array.from(table.querySelectorAll('tr')).map((r) => r.children.length));
    for (let c = 0; c < columns; c++) {
      const cells = rows.map((r) => r.children[c]).filter((x): x is Element => Boolean(x));
      const filled = cells.filter((x) => (x.textContent ?? '').trim());
      const numeric = filled.length > 0 && filled.every((x) => isNumericCell(x.textContent ?? ''));
      for (const cell of [table.querySelector(`thead tr`)?.children[c], ...cells]) cell?.classList.toggle('num', numeric);
    }
    // ids, codes and single words stay on one line instead of breaking at every hyphen
    for (const cell of Array.from(table.querySelectorAll('th, td'))) cell.classList.toggle('nw', isUnbreakable(cell.textContent ?? ''));
  }
}
