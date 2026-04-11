# Stock / Warehouse / Serial Integrity — Audit, Write-Path Fixes, Correction

Date: 2026-04-11
Status: **PHASE 4 + 5 SHIPPED TO QA.** Prod tags pending user verification.
Scope: All eligible businesses (has non-deleted warehouse AND at least one symptom)
Gate: Human-in-the-loop XLSX review before any write — XLSX reviewed 2026-04-11

## Decisions (evolved through 2026-04-11)

1. **Phase 6 (Stock Correction UI) — DESCOPED.** Extend the existing scheduler instead.
2. **Buy Back fix (RC10) — DEFERRED write-path fix; AUTO-SKIP in correction.** 12 products with Buy Back txn history are in `skipProductsQty` + `skipProductsWarehouse` sets — scheduler does not auto-correct them. Flag only. Manual review required.
3. **Job Work In fix — INCLUDED IN SIGN TABLE AS +1.** 31 products. Per `businessproducts-correction.md` memory, Job Work In is a legitimate stock-in txn type. Products still get flagged for visibility because warehouseData is rare on these rows (~0.05%), so warehouse rollup may be partial.
4. **Restaurant-gate inversion — SHIPPED** (MongoDbService commits `4e24d37b`, `4170458c`). Primary cause of the 347-business scale is now fixed at write time.
5. **Empty `serialData[i].warehouseData` — AUTO-ASSIGN YES.** Priority: another serial on same product → first whId in current warehouseDetails → first warehouse in business master → leave empty. v4 audit has 1,918 serials getting auto-assigned across 703 products.
6. **No new reconcile endpoint.** `UpdateStockDetailsRequest` extended with optional `warehouseDetails` passthrough (MongoDbService commit `9d68f4f8`).
7. **Option C warehouse rebuild.** `expectedWhMap[W] = max(txnSum[W], unsoldSerialCount[W])`. Handles pure-serial, mixed-stock, and non-serial products uniformly.
8. **Cross-biz leak filter.** After Option C, drop any warehouseId not in the business's own warehouse master. Products with pure sync contamination rebuild to `[]`.
9. **Opening Stock per-warehouse attribution.** Distribute `product.openingStockQty` across warehouses using the `Opening Stock` txn's `warehouseData` field when present; remainder to first-seen-txn warehouse.
10. **qty > 0 filter.** After Option C + cross-biz filter, drop any `expectedWhMap[W] ≤ 0` from the rebuild. No negative warehouse qty proposed.
11. **`availableQuantity = maxQuantity`** for non-restaurant businesses. For restaurant + `restaurantQtyEnabled=true`, `= maxQuantity * 2`. The prior "2x quirk is deliberate" claim in `businessproducts-correction.md` was wrong — it's been corrected.

## Final audit result (Phase 1b v4, 2026-04-11 18:23)

After applying decisions 7-11, the warehouse mismatch count dropped by **68%** vs v3 — most of v3's warehouse "mismatches" were cross-biz contamination and negative-qty noise.

| Metric | v3 (16:43) | **v4 (18:23)** |
|---|---:|---:|
| Eligible businesses | 347 | **348** |
| Products examined | 93,157 | **93,363** |
| Products with qty mismatch | 3,621 | 3,638 |
| Products with warehouse mismatch | 14,495 | **4,796** ↓68% |
| Products with serial mismatch | 1,307 | 835 |
| Buy Back products (flagged) | 12 | 12 |
| Job Work products (flagged) | 31 | 31 |
| Blank-warehouse-txn products | 7,917 | 7,926 |
| Absolute qty delta | 314,958 | 314,903 |
| Distinct products to correct | 15,592 | **5,978** |
| Invariant violations | 13,842 | **3,981** ↓71% |

**v4 XLSX:** `/tmp/stock-audit/stock_audit_20260411_1823.xlsx`
**Audit script:** `/tmp/stock-audit/audit.js` (mongosh, runs in pod via `kubectl exec prod-cluster-mongos-0 -- mongosh --file /tmp/audit.js`)
**XLSX builder:** `/tmp/stock-audit/build_xlsx.py` (Python, reads NDJSON → openpyxl)

### v4 sheet inventory

| Sheet | Rows | Purpose |
|---|---:|---|
| `products_to_correct` | 5,978 | Per-product correction plan — start here |
| `product_qty_mismatch` | 3,602 | Qty detail (filters out Buy Back / Job Work flagged rows) |
| `product_warehouse_mismatch` | 5,105 | Warehouse detail (multi-row per product) |
| `serial_warehouse_mismatch` | 2,279 | Serial detail + proposedWarehouseId for auto-assign |
| `invariant_violations` | 3,981 | Internal inconsistency diagnostic |
| `summary` | 352 | Per-business rollup |

### v4 willAutoCorrect breakdown (from `products_to_correct`)

| willAutoCorrect value | Products |
|---|---:|
| `WAREHOUSE` only | 3,395 |
| `QTY` only | 2,103 |
| `QTY + WAREHOUSE` | 412 |
| `(none)` — serial issue only (flag-only) | 38 |
| `SKIPPED (flagged)` — Buy Back / Job Work / BlankWhTxn | 30 |
| **Total distinct products** | **5,978** |

### Empty-serial auto-assign breakdown (from `serial_warehouse_mismatch`)

- **1,918 serials** across **703 products** get auto-assigned to a default warehouse
- **1,690 serials** have no fallback target → stay flagged for manual review
- Default warehouse spread across many businesses (top 5: 154/154/139/128/118 serials)

## Phase 4 + 5 commits (all on master, QA auto-deploying, none prod-tagged)

| # | Service | Commit | Purpose |
|---|---|---|---|
| 1 | MongoDbService | `4e24d37b` | Restaurant-gate + `*2` fix on sale/purchase/transfer hot paths (RC1–RC5) |
| 2 | MongoDbService | `4170458c` | Same on opening-stock/manufacture/raw-material (RC6–RC8) |
| 3 | PosClientBackend | `fe9dc860` | Expand warehouse txn whitelist (RC9) — Add Stock / Remove Stock / Damage Stock / Manufacture / Raw Material |
| 4 | MongoDbService | `9d68f4f8` | `updateProductStockQty` accepts `warehouseDetails` passthrough |
| 5 | Scheduler | `605b338` | Initial scheduler extension (warehouse correction dry-run gated by flag) |
| 6 | Scheduler | `e564c50` | **Full Option C port** — cross-biz filter + openingStockWh + Job Work In +1 + qty>0 + two-tier skip semantics |

## Rollout plan

1. ✅ **Phase 4 code pushed to QA** (all 6 commits)
2. ⏳ **QA verification (1 day bake)** — smoke test a non-restaurant sale, verify:
   - `maxQuantity −= 1` (not 2)
   - `availableQuantity == maxQuantity` (not `*2`)
   - `warehouseDetails[wh].qty −= 1` (previously untouched)
3. ⏳ **Production tag Phase 4 services** — MongoDbService + PosClientBackend
4. ⏳ **Production tag Scheduler** (still dry-run default)
5. ⏳ **First prod scheduler run** — watch for `[WH-DRYRUN]` log lines, pull log, diff against v4 XLSX
6. ⏳ **If dry-run output matches v4** → flip `stock.correction.warehouse.dryRun=false` for pilot businesses (Tungasree + 1-2 others)
7. ⏳ **Re-run audit** after pilot — mismatch counts should drop for pilot set
8. ⏳ **Broaden to all 348 businesses** if pilot clean

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

**Current state:** `Scheduler/.../ProductStockRepository.java` already aggregates `productTxn` per product, already writes `DailyProductStockScheduler` records, and already has the correct restaurant gate (2026-04-03 draft). **Gaps vs what Phase 5 needs:**

- Line 248: `double availableQty = maxQty * 2` — hardcoded, same bug as RC1/RC2. The scheduler was *perpetuating* the `*2` corruption on every nightly run for restaurant products.
- `UpdateStockDetailsRequest` (Scheduler copy `Scheduler/.../UpdateStockDetailsRequest.java`) has fields `maxQuantity, availableQuantity, batchData, freeQty, productId, businessId` — **no `warehouseDetails`, no `serialWarehouseMap`**. So the correction RPC can't carry warehouse data to MongoDbService even if we wanted it to.
- `MongoDbProductTxnFilterRequest` currently streams productTxn by businessId only — aggregation is done client-side. To add per-warehouse grouping we either (a) keep client-side and add new maps, or (b) push the aggregation into MongoDbService via a new endpoint. Option (a) is simpler and matches existing style.

**New method** `productStockWithWarehouseAndSerial()`:

1. Pull `productTxn` paginated (existing `getTransactionQty` pattern).
2. Build four maps:
   - `product_total[pid] → signed qty` (existing)
   - `product_wh[(pid, whId)] → signed qty` (NEW — non-serial warehouse rollup)
   - `product_batch[pid][batchNo] → signed qty` (existing)
   - `products_with_buyback: set[pid]` (NEW — flag for manual review)
3. Pull `businessProducts` paginated (existing).
4. For each product:
   - If serial: rebuild `expectedWarehouseDetails` from `count(serialData.warehouseData=W where not soldStatus)`.
   - If non-serial: rebuild from `product_wh[(pid, W)]` map.
   - Compute `expectedMaxQty = product_total[pid] + openingStockQty`.
   - Compute `expectedAvailableQty = (isRestaurant && restaurantQtyEnabled) ? expectedMaxQty * 2 : expectedMaxQty` — NOT a blind `*2`.
   - Skip correction if product is in `products_with_buyback` (flag for manual review).
5. Build a `ReconcileStockAndWarehouseRequest` and call new MongoDbService endpoint.

**New model** `ReconcileStockAndWarehouseRequest` (`oneshell-commons-model` or Scheduler copy):

```java
public class ReconcileStockAndWarehouseRequest {
    private String businessId;
    private String businessCity;
    private String productId;
    private double maxQuantity;
    private double availableQuantity;
    private List<BatchData> batchData;
    private List<WarehouseData> warehouseDetails;   // NEW
    private boolean dryRun;                         // NEW
    private long updatedAt;
}
```

**New MongoDbService endpoint** `POST /v1/core/db/product/reconcileStockAndWarehouse`:

- Path: `MongoDbService/.../ProductController.java` + delegate in `ProductService/Impl`.
- Behavior: one `findAndModify` per product setting `maxQuantity, availableQuantity, batchData, warehouseDetails, updatedAt` atomically. No per-field increment — this is a reconciliation, not a delta update. Does not touch `serialData` (serial's `warehouseData` is already correct per the Phase 0 decision to use it as truth).
- NO restaurant gate — this is a repair endpoint called with already-correct expected values.
- Returns `{beforeMaxQty, afterMaxQty, beforeWarehouseDetails, afterWarehouseDetails}` for audit trail.

**Extend `DailyProductStockScheduler` model** to capture before/after for warehouseDetails:

```java
public class DailyProductStockScheduler {
    // existing: businessId, productId, actualQty, correctedQty, date
    private List<WarehouseData> actualWarehouseDetails;     // NEW
    private List<WarehouseData> correctedWarehouseDetails;  // NEW
    private boolean dryRun;                                 // NEW
    private String correctionReason;                        // NEW (qty|warehouse|both)
}
```

**Modes** (config flag in `application.yaml`):

- `stock.correction.mode=dryRun` (default) — computes proposed changes, writes `DailyProductStockScheduler` records with `dryRun=true`, **does NOT call the reconcile endpoint**, re-emits the Phase 1 XLSX so the user can diff.
- `stock.correction.mode=live` — also calls the reconcile endpoint.
- `stock.correction.scope=businessId:b117...` — restrict to one business for pilot runs.

**Rollout order:**

1. Phase 4 ships all write-path fixes to prod (QA → tag → prod).
2. Phase 5 `dryRun=true` runs against prod for all 347 businesses.
3. The dryRun XLSX is compared to the Phase 1 XLSX — they should be **identical** (same data snapshot, same expected values). Any delta indicates a bug in the correction code, NOT a data bug.
4. User approves specific businesses (via `stock.correction.scope`).
5. `dryRun=false` runs for those businesses.
6. Re-run Phase 1 audit; verify zero remaining mismatches (except Buy Back flagged products).
7. Broaden to remaining businesses.

### Phase 6 — Stock correction UI (DESCOPED 2026-04-11)

Not needed — scheduler correction + audit XLSX are sufficient.

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
