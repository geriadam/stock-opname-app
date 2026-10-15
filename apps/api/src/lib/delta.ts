/** Apply opname delta without wiping sales that happened during the count. Clamps at 0. */
export function applyDelta(currentQty: number, systemQty: number, countedQty: number) {
  const raw = currentQty + (countedQty - systemQty);
  const newQty = Math.max(0, raw);
  return {
    newQty,
    delta: newQty - currentQty,
    clamped: raw < 0,
  };
}
