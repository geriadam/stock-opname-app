import { describe, expect, it } from 'vitest';
import { csvSafe, parseCountCsv } from '../src/services/csv.service.js';

describe('parseCountCsv', () => {
  it('parses valid rows', () => {
    const buf = Buffer.from('sku,counted_qty,note\nSKU-00001,5,ok\nSKU-00002,0,\n');
    const result = parseCountCsv(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ sku: 'SKU-00001', countedQty: 5, note: 'ok' });
  });

  it('flags duplicates unless mergeDuplicates', () => {
    const buf = Buffer.from('sku,counted_qty\nSKU-1,1\nSKU-1,2\n');
    const strict = parseCountCsv(buf, false);
    expect(strict.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);

    const merged = parseCountCsv(buf, true);
    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0]!.countedQty).toBe(2);
  });
});

describe('csvSafe', () => {
  it('prefixes formula-like cells', () => {
    expect(csvSafe('=1+1')).toBe("'=1+1");
    expect(csvSafe('+cmd')).toBe("'+cmd");
  });
});
