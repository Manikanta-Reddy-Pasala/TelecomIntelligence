# Stock Transfer API Split & Bug Fix Design

**Date:** 2026-04-07
**Status:** Approved
**Services:** PosClientBackend, PosFrontend

## Problem

The stock transfer API uses a single endpoint (`POST /v1/api/warehouse/stockTransfer`) for both initiating and completing transfers. The backend silently drops items during the complete flow due to three bugs:

1. **Null reversal kills saves:** `ProductTxnServiceImpl.saveAll()` calls `reverseProductTxn(existingDao, ...)` where `existingDao` is null for new records. When `isCalculateStockAndBalanceEnabled()` is true (prod/QA), `Mono.when(reversal, save)` fails silently, dropping that product's save.

2. **Mixed businessId in saveAll():** `StockTransferTransactionSagaService` builds a flat list mixing stockTransferOut (source businessId) and stockTransferIn (destination businessId). `saveAll()` takes businessId from the first item only (line 59), causing the delete-diff logic to use the wrong businessId context for half the items.

3. **Flux.merge error propagation:** In `saveAll()` line 161, `Flux.merge(deletedFlux, saveFlux)` cancels remaining items on the first error. One failed product kills all subsequent products.

## Solution

### New API Endpoints

| Endpoint | Purpose | When Used |
|----------|---------|-----------|
| `POST /v1/api/warehouse/stockTransfer/initiate` | Create stock transfer with status=Pending | New transfer, no stock movement |
| `POST /v1/api/warehouse/stockTransfer/complete` | Complete transfer, execute stock movement | All stockTransferIn/Out populated, status=Completed |

Old endpoint stays for backward compatibility — internally routes based on whether stockTransferIn/stockTransferOut are populated.

### Initiate Endpoint

**Request:** StockTransfer with `items[]`, empty `stockTransferIn[]` and `stockTransferOut[]`, `status` = Pending/In-Transit.

**Processing:**
1. Validate businessId, date
2. Save StockTransfer to MongoDB
3. Sync to remote (fire-and-forget)
4. No productTxn processing

### Complete Endpoint

**Request:** StockTransfer with `items[]`, populated `stockTransferIn[]` and `stockTransferOut[]`, `status` = Completed.

**Validation:**
- Stock transfer must already exist in DB
- `stockTransferIn` and `stockTransferOut` must be non-empty
- Each item in `items[]` must have corresponding In/Out entries
- Status must be "Completed"

**Processing:**
1. Validate request
2. Update StockTransfer status to Completed in MongoDB
3. Save productTxn for stockTransferOut (source business) — separate `saveAll()` call
4. Save productTxn for stockTransferIn (destination business) — separate `saveAll()` call
5. Sync to remote

### Bug Fixes

#### Fix 1: Split by businessId in StockTransferTransactionSagaService

In `saveTransactionsForStockTransfer()`, group ProductTxn list by businessId before calling `saveAll()`:

```java
// Instead of one flat list:
productTxnSagaService.saveProductTransactions(allProductTxns)

// Split by businessId:
Map<String, List<ProductTxn>> grouped = productTxns.stream()
    .collect(Collectors.groupingBy(ProductTxn::getBusinessId));

// Save each group separately, sequentially (out first, then in)
```

Save stockTransferOut first, then stockTransferIn. Sequential, not parallel — if Out fails, don't proceed with In.

#### Fix 2: Null-safe reversal in ProductTxnServiceImpl.saveAll()

At line 124, skip reversal when existingDao is null:

```java
Mono<Void> reversal = existingDao != null
    ? updateBalanceAndStockService.reverseProductTxn(existingDao, dao.isDeleted())
    : Mono.empty();
```

#### Fix 3: Error resilience in saveFlux

Add per-item error handling so one failed item doesn't cancel the batch. Log failures per-item for debugging.

### Frontend Changes

**WarehouseStore.js** — `saveTransferData()` method:
- `status !== 'Completed'` → call `initiateStockTransfer(InsertDoc)`
- `status === 'Completed'` → build In/Out via `addProductTxnForStockTransfer()`, call `completeStockTransfer(InsertDoc)`

**StockAllocationApiHelper.js** — add two new functions:
- `initiateStockTransfer(requestData)` → `POST /v1/api/warehouse/stockTransfer/initiate`
- `completeStockTransfer(requestData)` → `POST /v1/api/warehouse/stockTransfer/complete`

Keep existing `saveStockTransfer()` for backward compatibility.

No changes to `addProductTxnForStockTransfer()` — it already correctly builds all In/Out items in one pass.

### What Does NOT Change

- StockTransfer DAO/model — same data structure
- Delete endpoint — stays as-is
- Remote sync logic — stays as-is
- `UpdateBalanceAndStockService` — only the null check added at call site
- `addProductTxnForStockTransfer()` in frontend — already correct

## Files to Modify

### PosClientBackend
| File | Change |
|------|--------|
| `feature/warehouse/WarehouseController.java` | Add `/initiate` and `/complete` endpoints |
| `saga/workflows/StockTransferWorkflow.java` | Add complete pipeline, route old endpoint |
| `feature/saga/StockTransferTransactionSagaService.java` | Split productTxn list by businessId before saveAll |
| `feature/producttxn/ProductTxnServiceImpl.java` | Null-safe reversal (line 124), error resilience in saveFlux |

### PosFrontend
| File | Change |
|------|--------|
| `src/components/Helpers/apiQueries/Warehouse/StockAllocationApiHelper.js` | Add `initiateStockTransfer()` and `completeStockTransfer()` |
| `src/Mobx/Stores/WarehouseStore.js` | Route to initiate/complete based on status |

## Example Flow

**Initiate (4 products):**
```
POST /v1/api/warehouse/stockTransfer/initiate
{
  "id": "al111775500170",
  "status": "Pending",
  "items": [4 products],
  "stockTransferIn": [],
  "stockTransferOut": [],
  ...
}
```

**Complete (4 products):**
```
POST /v1/api/warehouse/stockTransfer/complete
{
  "id": "al111775500170",
  "status": "Completed",
  "items": [4 products],
  "stockTransferOut": [4 entries, businessId=source],
  "stockTransferIn": [4 entries, businessId=destination],
  ...
}
```

**Backend processing for complete:**
1. Validate: transfer exists, In/Out non-empty
2. Update StockTransfer status → Completed
3. `saveAll([4 stockTransferOut items])` — all source businessId
4. `saveAll([4 stockTransferIn items])` — all destination businessId
5. Sync to remote
