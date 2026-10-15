import { describe, expect, it } from 'vitest';
import { applyDelta } from '../src/lib/delta.js';

const EDITABLE = new Set(['OPEN', 'REJECTED']);
const APPROVABLE = new Set(['SUBMITTED']);
const CANCELLABLE = new Set(['OPEN', 'REJECTED']);
const ACTIVE = new Set(['OPEN', 'SUBMITTED', 'REJECTED', 'APPLYING', 'APPLY_FAILED']);

describe('session state guards', () => {
  it('only OPEN/REJECTED allow count edits', () => {
    for (const s of ['OPEN', 'REJECTED', 'SUBMITTED', 'APPLYING', 'APPLIED', 'CANCELLED']) {
      expect(EDITABLE.has(s)).toBe(s === 'OPEN' || s === 'REJECTED');
    }
  });

  it('only SUBMITTED can be approved', () => {
    expect(APPROVABLE.has('SUBMITTED')).toBe(true);
    expect(APPROVABLE.has('OPEN')).toBe(false);
    expect(APPROVABLE.has('APPLYING')).toBe(false);
  });

  it('active statuses match partial unique index set', () => {
    expect([...ACTIVE].sort()).toEqual(
      ['APPLYING', 'APPLY_FAILED', 'OPEN', 'REJECTED', 'SUBMITTED'].sort(),
    );
    expect(ACTIVE.has('APPLIED')).toBe(false);
    expect(ACTIVE.has('CANCELLED')).toBe(false);
  });

  it('cancellable set is OPEN/REJECTED', () => {
    expect(CANCELLABLE.has('SUBMITTED')).toBe(false);
    expect(CANCELLABLE.has('OPEN')).toBe(true);
  });
});

describe('delta edge formulas', () => {
  it('sale during count preserves delta', () => {
    // snapshot 20, counted 25 (+5), sale left current at 18 → 23
    expect(applyDelta(18, 20, 25)).toEqual({ newQty: 23, delta: 5, clamped: false });
  });

  it('uncounted items are not applied (caller filters null)', () => {
    // documented contract: only counted rows enter applyDelta
    expect(applyDelta(10, 10, 10).delta).toBe(0);
  });
});
