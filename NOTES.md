# Catatan Keputusan — Stock Opname

## 1. Interpretasi & pilihan

- **Stock per toko** — kuantitas di `store_stock(store_id, product_id)`. Satu SKU bisa beda stok di Store A vs B. User terikat satu toko.
- **Initiation wajib** — manager buat session → snapshot stok toko ke `opname_items` (`system_qty`). Satu session aktif per toko (unique index parsial).
  - Plus: baseline jelas, audit, cegah race 2 manager.
  - Minus: selama hitung, stok live bisa berubah (dijawab dengan **delta** saat approve).
- **Submit tidak ubah stok** — hanya status `SUBMITTED` + revision + snapshot JSONB. Stok berubah hanya setelah approve.
- **Duplikat / edit / resubmit** — duplikat SKU di batch → 422; edit boleh saat `OPEN`/`REJECTED`; reject → staff edit → submit lagi (revision+1); withdraw `SUBMITTED`→`OPEN`.
- **Session besar** — snapshot/apply SQL set-based, pagination keyset, batch max 500, CSV dry-run.

## 2. Alur approve → stok ter-update

1. Manager klik Approve → `POST .../approve` + Idempotency-Key.
2. TX singkat: lock session, status `APPLYING`, catat reviewer → response **202**.
3. UI poll tiap 2 detik.
4. Job pg-boss `apply-stock`: lock session, hitung  
   `new = max(0, current + (counted − system))`, update `store_stock`, tulis `stock_movements` (unique per session+product biar retry aman), status `APPLIED`.
5. Gagal → rollback apply, status `APPLY_FAILED`, retry otomatis / tombol Retry manager.

| Masalah | Penanganan |
|---|---|
| Double click / 2 manager | Lock + status + Idempotency-Key |
| Worker crash / jalan 2× | Cek status + unique ledger |
| Ada penjualan saat hitung | Formula delta, bukan overwrite |
| Hasil negatif | Clamp ke 0 |
| Apply lama | Async 202 + polling |

## 3. Item tidak dihitung

- **Kosong ≠ 0.** `counted_qty` null = belum dihitung.
- Submit tetap boleh (UI kasih warning).
- Saat apply, baris null **diabaikan** → stok lama tetap. Alasan: lupa hitung jangan sampai menghapus stok jadi 0.
- SKU master tapi tidak di snapshot → `is_unexpected`, `system_qty=0`, bisa dihitung; approve buat baris `store_stock` jika perlu.
- Angka `0` eksplisit = dihitung kosong (benar-benar nol).

## 4. Edge case yang di-handle

1. Dua session aktif sama toko → 409
2. CSV SKU unknown / qty jelek / duplikat → dry-run error
3. Edit setelah submit → diblok (withdraw/reject dulu)
4. Manager toko lain → 403
5. Penjualan selama count → delta
6. Reject → resubmit → revision baru + history
7. Staff tidak bisa approve; manager tidak edit count
8. Export CSV aman dari formula injection

## 5. Satu tambahan penting

**Ledger `stock_movements` + apply idempotent** — supaya retry worker tidak double-apply, dan ada jejak before/after/delta.  
Pendamping: **CSV import + dry-run** supaya tidak input ribuan baris manual.

## AI usage

AI dipakai untuk scaffold monorepo/boilerplate. Keputusan model (snapshot per toko, delta, blank≠0, RBAC, ledger) dan verifikasi alur login → count → approve dicek sendiri.
