import { describe, expect, it } from 'vitest';
import { applyDelta } from '../src/lib/delta.js';

describe('applyDelta', () => {
  it('applies positive variance on top of current stock', () => {
    // snapshot 10, counted 12, but a sale reduced current to 8 → new = 8 + 2 = 10
    expect(applyDelta(8, 10, 12)).toEqual({ newQty: 10, delta: 2, clamped: false });
  });

  it('clamps negative results at zero', () => {
    expect(applyDelta(1, 10, 0)).toEqual({ newQty: 0, delta: -1, clamped: true });
  });

  it('no-op when counted equals system', () => {
    expect(applyDelta(5, 5, 5)).toEqual({ newQty: 5, delta: 0, clamped: false });
  });
});
