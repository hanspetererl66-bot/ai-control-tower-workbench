import type { ChatAttachment } from './attachments';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field.trim());
      field = '';
    } else if (character === '\n') {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function numeric(value: string): number | null {
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatted(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function csvVerificationDigest(attachment: ChatAttachment): string {
  if (!attachment.name.toLowerCase().endsWith('.csv') || !attachment.extractedText) return '';
  const rows = parseCsv(attachment.extractedText);
  if (rows.length < 2) return '';
  const headers = rows[0];
  const data = rows.slice(1).filter((row) => row.length === headers.length);
  if (!data.length) return '';

  const lines = [
    `Deterministic CSV verification digest for ${attachment.name}:`,
    `- data rows: ${data.length}`,
  ];
  const numericColumns: { header: string; index: number; values: number[] }[] = [];
  headers.forEach((header, index) => {
    const values = data.map((row) => numeric(row[index] ?? ''));
    if (values.every((value): value is number => value !== null)) {
      numericColumns.push({ header, index, values });
      lines.push(
        `- ${header}: sum=${formatted(values.reduce((sum, value) => sum + value, 0))}; ` +
          `first=${formatted(values[0])}; last=${formatted(values.at(-1)!)}; ` +
          `min=${formatted(Math.min(...values))}; max=${formatted(Math.max(...values))}`
      );
    }
  });

  const causeColumns = numericColumns.filter(
    (column) => /returns?/i.test(column.header) && !/(?:cost|rate|resolution|total)/i.test(column.header)
  );
  const shipmentColumn = numericColumns.find((column) => /^shipments?$/i.test(column.header));
  if (causeColumns.length > 1) {
    const rowReturns = data.map((_row, rowIndex) =>
      causeColumns.reduce((sum, column) => sum + column.values[rowIndex], 0)
    );
    const totalReturns = rowReturns.reduce((sum, value) => sum + value, 0);
    lines.push(
      `- derived total returns (sum of ${causeColumns.map((column) => column.header).join(', ')}): ` +
        `all rows=${formatted(totalReturns)}; first row=${formatted(rowReturns[0])}; ` +
        `last row=${formatted(rowReturns.at(-1)!)}`
    );
    if (shipmentColumn) {
      const shipmentTotal = shipmentColumn.values.reduce((sum, value) => sum + value, 0);
      lines.push(
        `- derived return rates: first row=${formatted((rowReturns[0] / shipmentColumn.values[0]) * 100)}%; ` +
          `last row=${formatted((rowReturns.at(-1)! / shipmentColumn.values.at(-1)!) * 100)}%; ` +
          `overall=${formatted((totalReturns / shipmentTotal) * 100)}%`
      );
    }
  }

  return `${lines.join('\n')}\nUse these code-calculated values as authoritative. Do not replace them with estimates.`;
}

export function dataGroundingContext(attachments: ChatAttachment[]): string {
  const digests = attachments.map(csvVerificationDigest).filter(Boolean);
  if (!digests.length) return '';
  return `DATA GROUNDING — calculated by Werkbank before the model run:\n\n${digests.join('\n\n')}`;
}
