import { parse } from 'csv-parse/sync';
import { AppError } from '../lib/errors.js';
import { CSV_MAX_ROWS, MAX_COUNTED_QTY } from '../config.js';

export type CsvRow = {
  line: number;
  sku: string;
  countedQty: number;
  note?: string;
};

export type CsvParseResult = {
  rows: CsvRow[];
  errors: Array<{ line: number; sku?: string; message: string }>;
  duplicates: Array<{ sku: string; lines: number[] }>;
};

export function parseCountCsv(buffer: Buffer, mergeDuplicates = false): CsvParseResult {
  let records: Record<string, string>[];
  try {
    records = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', `CSV parse failed: ${String(err)}`, 400);
  }

  if (records.length > CSV_MAX_ROWS) {
    throw new AppError('VALIDATION_ERROR', `CSV exceeds ${CSV_MAX_ROWS} rows`, 400);
  }

  const errors: CsvParseResult['errors'] = [];
  const bySku = new Map<string, CsvRow[]>();

  records.forEach((rec, idx) => {
    const line = idx + 2; // header is line 1
    const sku = (rec.sku ?? rec.SKU ?? '').trim();
    const qtyRaw = (rec.counted_qty ?? rec.countedQty ?? rec.qty ?? '').trim();
    const note = (rec.note ?? '').trim() || undefined;

    if (!sku) {
      errors.push({ line, message: 'Missing SKU' });
      return;
    }
    if (qtyRaw === '') {
      errors.push({ line, sku, message: 'Missing counted_qty' });
      return;
    }
    if (!/^\d+$/.test(qtyRaw)) {
      errors.push({ line, sku, message: 'counted_qty must be a non-negative integer' });
      return;
    }
    const countedQty = Number(qtyRaw);
    if (countedQty > MAX_COUNTED_QTY) {
      errors.push({ line, sku, message: `counted_qty exceeds ${MAX_COUNTED_QTY}` });
      return;
    }

    const row: CsvRow = { line, sku, countedQty, note };
    const list = bySku.get(sku) ?? [];
    list.push(row);
    bySku.set(sku, list);
  });

  const duplicates: CsvParseResult['duplicates'] = [];
  const rows: CsvRow[] = [];

  for (const [sku, list] of bySku) {
    if (list.length > 1) {
      duplicates.push({ sku, lines: list.map((r) => r.line) });
      if (mergeDuplicates) {
        // last write wins
        rows.push(list[list.length - 1]!);
      } else {
        for (const r of list) {
          errors.push({ line: r.line, sku, message: 'Duplicate SKU in CSV' });
        }
      }
    } else {
      rows.push(list[0]!);
    }
  }

  return { rows, errors, duplicates };
}

/** Prefix formula-like cells so Excel won't execute them. */
export function csvSafe(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) {
    return `'${s}`;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
