# Stock / Warehouse / Serial Integrity — Audit, Write-Path Fixes, Correction

Date: 2026-04-11
Status: IN PROGRESS
Scope: All eligible businesses (has non-deleted warehouse AND at least one symptom)
Gate: Human-in-the-loop XLSX review before any write

## 1. Problem statement

Four interrelated data inconsistencies in `businessProducts`:

1. `serialData[i].warehouseData` points to a warehouseId that is **not present** in the product's `warehouseDetails[*].warehouseId`.
2. `warehouseDetails` is **empty** on a product even though `serialData[i].warehouseData` references real warehouses.
3. `maxQuantity` diverges from transaction history.
4. The nightly stock scheduler fixes `maxQuantity` only — it does not touch `warehouseDetails` or `serialData.warehouseData`, so those drift unrecovered.

## 2. Phase 0 findings (read-only survey, prod)

| Metric | Count |
|---|---|
| Businesses with at least one warehouse | 382 |
| Businesses with at least one product having empty `warehouseDetails` | 1,095 |
| Businesses with at least one serial-warehouse mismatch | 55 |
| **Eligible scope** (has warehouse AND any symptom) | **347** |

### Data model — authoritative sources

| Field | Source of truth |
|---|---|
| `businessProducts.maxQuantity` | `sum(productTxn.txnQty)` signed by txnType + `openingStockQty` |
| `businessProducts.availableQuantity` | `maxQuantity * 2` iff restaurant business AND `restaurantQtyEnabled=true`, else `= maxQuantity` |
| `businessProducts.warehouseDetails[].qty` (non-serial) | `sum(productTxn.txnQty)` signed, grouped by `productTxn.warehouseData` |
| `businessProducts.warehouseDetails[].qty` (serial) | `count(serialData where warehouseData = whId AND NOT soldStatus)` |
| `serialData[i].warehouseData` | Current snapshot (productTxn does not carry `serialNo[]` for Add Stock / Sales, so history cannot be replayed) |

### productTxn coverage gaps

| txnType | `warehouseData` populated? | `serialNo[]` populated? |
|---|---|---|
| Add Stock | 100% | **0%** |
| Purchases | (same pattern as Add Stock) | 0% |
| Sales | ~99% (1% blank) | **0%** |
| Sales Return / Purchases Return | ~99% | 0% |
| Stock Transfer In / Out | 100% | 78% / 100% |
| Sale Order (does not move stock) | ~75% | 0% |
| **Buy Back** | **0%** | 0% |

- **Buy Back does not record warehouseData** — products with Buy Back history will be flagged "low confidence" in the audit.
- **serialNo[] is not written for Add Stock / Sales** — we cannot replay serial→warehouse history. The audit must treat current `serialData` as truth for serials.

## 3. Root causes found (Phase 2 — MongoDbService/ProductServiceImpl.java)

| # | Write path | File:line | Bug | Impact |
|---|---|---|---|---|
| RC1 | `updateQtyAtomically` (sale / purchaseReturn) | `ProductServiceImpl.java:1646`, `1650-1652` | `availableQtyChange = 2*quantity` hardcoded regardless of business type. No `warehouseDetails` update. No serial-warehouse update. | Every sale corrupts `availableQuantity` to `maxQuantity*2` on non-restaurant businesses and leaves `warehouseDetails` untouched. Primary cause of the 1,095-business empty/incorrect warehouseDetails scale. |
| RC2 | `updatePurchaseQtyAtomically` (purchase / salesReturn) | `ProductServiceImpl.java:1774`, `1778-1780` | Same hardcoded `*2`. No `warehouseDetails` update. | Symmetric to RC1. Every purchase/return leaves warehouseDetails untouched. |
| RC3 | `updateQtyInBusinessProductsAtomically` | `ProductServiceImpl.java:1355-1358` | `if (!product.isRestaurantQtyEnabled()) return Mono.empty()` — hard gate blocks ALL stock updates for non-restaurant businesses or restaurant products without qty-tracking opt-in. | All sale/purchase/return stock updates silently skip on non-restaurant businesses. The Scheduler memory `stock-bugs.md` flagged 9 locations; this is one of them. |
| RC4 | `updateStockTransferStockAtomic` | `ProductServiceImpl.java:2088-2091` | Same restaurant-gate skip. | Stock transfers never update `warehouseDetails` for non-restaurant businesses — main cause of the 55 serial-mismatch businesses (Dell/Alienware sellers are all non-restaurant). |
| RC5 | `updateStockTransferStockAtomic` (success path) | `ProductServiceImpl.java:2184` | `qtyUpdate.inc("availableQuantity", txnQty * 2)` hardcoded. | Same `*2` bug propagated through transfer flows. |
| RC6 | `updateStockDetails` (bulk stock + serial save) | `ProductServiceImpl.java:612-633` | Sets `maxQuantity, availableQuantity, batchData, serialData` — no `warehouseDetails` update. | Edit-product and recovery paths wipe any reliance on sync between warehouseDetails and the new max/serial state. |
| RC7 | `updateOpeningStockQty` | `ProductServiceImpl.java:739-753` | Same as RC6 — sets maxQuantity/availableQuantity, no warehouseDetails. | Opening-stock changes cause warehouseDetails to drift. |
| RC8 | `updateProductStockQty` (used by Scheduler corrections) | `ProductServiceImpl.java:832-850` | Sets maxQuantity/availableQuantity/batchData, no warehouseDetails. | **The nightly scheduler uses this path**, which is why `stockScheduler` fixes `maxQuantity` but does not heal `warehouseDetails`. |
| RC9 | `PosClientBackend UpdateBalanceAndStockService.updateWarehouseStockForTxn` | `UpdateBalanceAndStockService.java:528-664` | Txn-type whitelist covers only `{Sales, Purchases Return, Purchases, Sales Return}`. **Missing**: `Add Stock, Remove Stock, Damage Stock, Manufacture, Raw Material, Stock Transfer In/Out, Buy Back`. | Stock-moving transactions outside the 4-type whitelist never call the one method (`productService.updateWarehouseStock`) that correctly maintains `warehouseDetails` atomically. Stock transfers rely on a separate (gated) path (RC4). Add Stock etc. have **no path at all**. |
| RC10 | Buy Back txn path | (same `updatePurchaseQtyAtomically` + productTxn writer) | Buy Back txn does not record `warehouseData`, and `updatePurchaseQtyAtomically` doesn't update warehouseDetails. | Products with Buy Back history have unrecoverable warehouse inventory — the history isn't even there to rebuild from. |

### The one correct path: `updateWarehouseStockAtomic` (`ProductServiceImpl.java:1916-2015`)

A single-document aggregation pipeline that correctly:
- Adds a warehouse entry if missing.
- Increments an existing entry's qty if present.
- Has NO restaurant gate.
- Handles both product-level and batch-level `warehouseDetails`.

**It is the target** for every write path that should touch warehouse stock. RC9 says it's only wired up for 4 txn types; it should be wired up for all stock-moving flows.

## 4. Plan

### Phase 1 — Audit (READ-ONLY, XLSX) ✅ IMPLEMENTED

Python + pymongo + openpyxl. Entry point `/tmp/stock-audit/audit.py`. Writes 4-sheet XLSX:

- **`product_qty_mismatch`** — rows where current `maxQuantity` != expected from productTxn + openingStockQty.
- **`product_warehouse_mismatch`** — rows where product-level `warehouseDetails[whId].qty` diverges from expected (computed from productTxn sum-by-warehouse for non-serial, from `count(serialData)` for serial).
- **`serial_warehouse_mismatch`** — rows where a serial's `warehouseData` is empty, not in product's `warehouseDetails`, or not in business master warehouses.
- **`summary`** — per-business counts and grand totals.

### Phase 1b — Run audit, deliver XLSX ⚙️ RUNNING

Background job against port-forwarded prod Mongo. Output: `/tmp/stock-audit/stock_audit_<YYYYMMDD_HHMM>.xlsx`. No writes.

### Phase 3 — User review gate

User opens XLSX, spot-checks rows against productTxn, approves/rejects/scopes the correction.

### Phase 4 — Write-path fixes (ship to prod BEFORE running correction)

Each line item → separate commit:

1. **RC1/RC2/RC5 (availableQuantity *2 bug)** — Pass `isRestaurant AND restaurantQtyEnabled` into the atomic paths; gate the `*2` multiplier. Non-restaurant: `availableQtyChange = qtyChange`. Tests: non-restaurant sale updates `availableQuantity` by 1 not 2.
2. **RC3 (restaurant gate on sale/purchase)** — Invert the gate: `if (isRestaurant && !product.isRestaurantQtyEnabled()) skip`. Non-restaurant always updates. Already drafted in `stock-bugs.md` but uncommitted — pick it up.
3. **RC4 (restaurant gate on stock transfer)** — Same inversion. Non-restaurant transfers should update warehouseDetails.
4. **RC6/RC7/RC8 (write paths that set max/avail but not warehouseDetails)** — Add a secondary call chain: after `findAndModify`, if the request carries a warehouseId list, call `updateWarehouseStockAtomic` to reconcile. For `updateProductStockQty` (scheduler correction), accept a `Map<String,Double> warehouseDeltas` in the request and apply it via the aggregation pipeline.
5. **RC9 (txn-type whitelist)** — Expand `INCREMENT_WAREHOUSE_TXN_TYPES` / `DECREMENT_WAREHOUSE_TXN_TYPES` in `UpdateBalanceAndStockService.java:528-529` to include Add Stock, Remove Stock, Damage Stock, Manufacture, Raw Material. Stock Transfer In/Out already flow through their dedicated path but should defense-in-depth here. Tests per txn type.
6. **RC10 (Buy Back missing warehouseData)** — PosClientBackend productTxn writer for Buy Back must set `warehouseData`. Then include Buy Back in the warehouse update whitelist. Open question: is Buy Back allowed on restaurant products? (Affects gating.)
7. **Regression tests** — per-path integration test asserting `maxQuantity`, `availableQuantity`, `warehouseDetails[wh].qty`, and (for serial products) `serialData[i].warehouseData` all move consistently after each stock-moving operation.

Each commit: QA deploy, smoke test, tag for prod per release workflow.

### Phase 5 — One-shot correction job (dryRun → live)

Extend `Scheduler/.../ProductStockRepository.java` with `productStockWithWarehouseAndSerial()`:

- Re-reads productTxn (same way) + groups by `(productId, warehouseData)` and by `(productId, batchNumber, warehouseData)`.
- For serial products, rebuilds `warehouseDetails` from `count(serialData.warehouseData=W where not soldStatus)`.
- Writes extended records to `DailyProductStockScheduler` capturing before/after for all three dimensions.
- Calls MongoDbService via a new endpoint `POST /v1/core/db/product/reconcileStockAndWarehouse` that atomically updates `maxQuantity`, `availableQuantity`, `warehouseDetails`, and (optionally) `serialData[i].warehouseData` per product.
- Modes:
  - `dryRun=true` (default) — re-emits the XLSX (same format as Phase 1) with proposed changes. Compare to Phase 1 XLSX; deltas indicate code bugs, not data bugs.
  - `dryRun=false` — performs the update.
- Order of operations: Phase 4 must be in prod FIRST (so newly-created data is clean), THEN the one-shot correction repairs historical damage.

### Phase 6 — Stock correction UI (deferred)

PosAdmin page with 4 tabs matching audit sheets, per-row approve checkboxes, "run correction" scoped to approved rows. Deferred until Phase 5 is stable.

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Buy Back historical data is unrecoverable (no warehouseData) | Audit flags products with Buy Back history; those rows are excluded from auto-correction and escalated for manual review. |
| Sales without warehouseData (~1% per sample) | Same — flag and escalate. |
| Parent-to-child sync re-corrupting data after correction | `mongoEventListner v0.0.42` (shipped 2026-04-11) now preserves `warehouseDetails` on CDC sync. Monitor the 55 serial-mismatch businesses post-correction. |
| Correction job writes incorrect expected values | DryRun must produce identical XLSX to Phase 1 on same data snapshot. |
| Locking conflicts during correction on busy businesses | Use existing `businessEntityLockService.executeStockOperation` per product; retry on lock timeout. |
| Restaurant businesses with `restaurantQtyEnabled=false` products | Those products are intentionally not stock-tracked — audit and correction must skip them, not zero them out. |

## 6. Open questions (for user review)

1. **Buy Back scope** — fix the write path (RC10) as part of Phase 4, or treat as out-of-scope for this plan?
2. **Restaurant-gate inversion** — the fix draft in `stock-bugs.md` is uncommitted across 9 locations. Is that draft still good to pick up, or does it need a fresh review?
3. **Serial warehouseData correction** — should the correction job fix serials where `warehouseData` is empty by using the business's default warehouse, or leave them empty and require manual assignment?
4. **Phase 5 endpoint** — OK to add the new `POST /v1/core/db/product/reconcileStockAndWarehouse` endpoint in MongoDbService, or do you want the correction job to use existing endpoints (slower, chatty)?
