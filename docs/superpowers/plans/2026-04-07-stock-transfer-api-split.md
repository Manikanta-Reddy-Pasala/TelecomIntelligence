# Stock Transfer API Split & Bug Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix silent data loss in stock transfer completion by splitting the single endpoint into `/initiate` and `/complete`, and fixing three bugs in the productTxn save pipeline.

**Architecture:** Add two new controller endpoints that delegate to the existing StockTransferWorkflow. Fix the core `saveAll()` bugs (null reversal, mixed businessId, error propagation). Frontend routes to the correct endpoint based on status.

**Tech Stack:** Spring Boot 3.3 / Java 21 / WebFlux (backend), React 16.14 / MobX (frontend)

**Spec:** `docs/superpowers/specs/2026-04-07-stock-transfer-api-split-design.md`

---

### Task 1: Fix null-safe reversal in ProductTxnServiceImpl.saveAll()

This is the primary bug causing silent data loss. Fix it first.

**Files:**
- Modify: `PosClientBackend/src/main/java/com/pos/backend/feature/producttxn/ProductTxnServiceImpl.java:124-125`

- [ ] **Step 1: Fix null reversal**

In `ProductTxnServiceImpl.java`, replace lines 124-125:

```java
                                    // Reversal reads from existingDao (immutable), save writes dao — independent, run in parallel
                                    Mono<Void> reversal = updateBalanceAndStockService
                                            .reverseProductTxn(existingDao, dao.isDeleted());
```

With:

```java
                                    // Skip reversal for new records (existingDao is null on first save)
                                    Mono<Void> reversal = existingDao != null
                                            ? updateBalanceAndStockService.reverseProductTxn(existingDao, dao.isDeleted())
                                            : Mono.empty();
```

- [ ] **Step 2: Add per-item error logging in saveFlux**

In the same file, wrap the inner `flatMap` return (the `Mono.when(reversal, save)` chain at lines 128-140) with error logging. Replace:

```java
                                    return Mono.when(reversal, save)
                                            .then(Mono.defer(() -> {
                                                log.debug("  SAVED to DB: id={}, type={}, qty={}, deleted={}",
                                                        dao.getProductTxnId(),
                                                        dao.getTxnType(),
                                                        dao.getTxnQty(),
                                                        dao.isDeleted());

                                                // Update AFTER save (apply new stock values)
                                                return updateBalanceAndStockService
                                                        .update("productTxn", "Save", dao, "save")
                                                        .thenReturn(productTxnMapper.toDto(dao));
                                            }));
```

With:

```java
                                    return Mono.when(reversal, save)
                                            .then(Mono.defer(() -> {
                                                log.debug("  SAVED to DB: id={}, type={}, qty={}, deleted={}",
                                                        dao.getProductTxnId(),
                                                        dao.getTxnType(),
                                                        dao.getTxnQty(),
                                                        dao.isDeleted());

                                                // Update AFTER save (apply new stock values)
                                                return updateBalanceAndStockService
                                                        .update("productTxn", "Save", dao, "save")
                                                        .thenReturn(productTxnMapper.toDto(dao));
                                            }))
                                            .doOnError(error -> log.error("  FAILED to save productTxn: id={}, type={}, error={}",
                                                    dao.getProductTxnId(), dao.getTxnType(), error.getMessage()));
```

- [ ] **Step 3: Compile and verify**

Run:
```bash
cd PosClientBackend && ./mvnw clean compile -DskipTests
```
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add PosClientBackend/src/main/java/com/pos/backend/feature/producttxn/ProductTxnServiceImpl.java
git commit -m "fix: null-safe reversal in ProductTxnServiceImpl.saveAll() to prevent silent data loss"
```

---

### Task 2: Split productTxn list by businessId in StockTransferTransactionSagaService

**Files:**
- Modify: `PosClientBackend/src/main/java/com/pos/backend/feature/saga/StockTransferTransactionSagaService.java:32-50`

- [ ] **Step 1: Add Collectors import**

At the top of `StockTransferTransactionSagaService.java`, add to the existing imports:

```java
import java.util.Map;
import java.util.stream.Collectors;
```

- [ ] **Step 2: Replace saveTransactionsForStockTransfer method**

Replace the existing `saveTransactionsForStockTransfer` method (lines 32-50) with:

```java
    /**
     * Save product transactions for a stock transfer.
     * Splits by businessId to avoid mixed-business saveAll() calls.
     * Saves stockTransferOut (source) first, then stockTransferIn (destination) sequentially.
     */
    public Mono<TransactionResult> saveTransactionsForStockTransfer(StockTransfer stockTransfer) {
        log.debug("Saving product transactions for stock transfer: {}", stockTransfer.getId());

        List<ProductTxn> productTxns = buildProductTransactionsFromStockTransfer(stockTransfer);

        if (productTxns.isEmpty()) {
            log.debug("No product transactions to save for stock transfer: {}", stockTransfer.getId());
            return Mono.just(TransactionResult.builder()
                    .productTransactions(new ArrayList<>())
                    .success(true)
                    .build());
        }

        // Group by businessId — stockTransferOut (source) and stockTransferIn (destination) have different businessIds
        Map<String, List<ProductTxn>> groupedByBusiness = productTxns.stream()
                .collect(Collectors.groupingBy(ProductTxn::getBusinessId));

        log.debug("Stock transfer {} has {} business groups: {}", stockTransfer.getId(),
                groupedByBusiness.size(), groupedByBusiness.keySet());

        // Save each business group sequentially (out first, then in)
        // Sequential ensures if source fails, we don't proceed with destination
        List<ProductTxn> allSaved = new ArrayList<>();

        Mono<Void> saveChain = Mono.empty();
        for (Map.Entry<String, List<ProductTxn>> entry : groupedByBusiness.entrySet()) {
            String businessId = entry.getKey();
            List<ProductTxn> txns = entry.getValue();
            saveChain = saveChain.then(
                    productTxnSagaService.saveProductTransactions(txns)
                            .doOnSuccess(saved -> {
                                log.debug("Saved {} productTxns for businessId={}", saved.size(), businessId);
                                allSaved.addAll(saved);
                            })
                            .then()
            );
        }

        return saveChain.then(Mono.fromCallable(() -> TransactionResult.builder()
                .productTransactions(allSaved)
                .success(true)
                .build()));
    }
```

- [ ] **Step 3: Compile and verify**

Run:
```bash
cd PosClientBackend && ./mvnw clean compile -DskipTests
```
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add PosClientBackend/src/main/java/com/pos/backend/feature/saga/StockTransferTransactionSagaService.java
git commit -m "fix: split productTxn saves by businessId to prevent mixed-business data loss"
```

---

### Task 3: Add /initiate and /complete endpoints to WarehouseController

**Files:**
- Modify: `PosClientBackend/src/main/java/com/pos/backend/feature/warehouse/WarehouseController.java:197-214`

- [ ] **Step 1: Add the /initiate endpoint**

In `WarehouseController.java`, add this method right after the existing `saveStockTransfer` method (after line 214):

```java
    @Operation(
            summary = "Initiate a Stock Transfer",
            description = "Creates a new stock transfer with Pending status. No stock movement occurs.",
            responses = {
                    @ApiResponse(responseCode = "200", description = "Stock transfer initiated successfully"),
                    @ApiResponse(responseCode = "400", description = "Invalid input"),
                    @ApiResponse(responseCode = "500", description = "Internal server error")
            }
    )
    @PostMapping("/stockTransfer/initiate")
    public Mono<ResponseEntity<StockTransfer>> initiateStockTransfer(
            @RequestBody StockTransfer stockTransfer,
            @RequestHeader(value = "employeeId", required = false, defaultValue = "system") String employeeId,
            @RequestHeader(value = "employeeName", required = false, defaultValue = "System") String employeeName) {

        long start = System.currentTimeMillis();
        log.debug("Initiating stock transfer: {}", stockTransfer.getId());

        // Clear any stockTransferIn/Out that shouldn't be present during initiation
        stockTransfer.setStockTransferIn(java.util.Collections.emptyList());
        stockTransfer.setStockTransferOut(java.util.Collections.emptyList());

        return stockTransferWorkflow.processStockTransferSave(stockTransfer, employeeId, employeeName)
                .map(saved -> {
                    long duration = System.currentTimeMillis() - start;
                    log.debug("Stock transfer initiated in {} ms: {}", duration, saved.getId());
                    return ResponseEntity.ok(saved);
                })
                .doOnError(error -> {
                    long duration = System.currentTimeMillis() - start;
                    log.error("Error initiating stock transfer after {} ms: {}", duration, error.getMessage());
                });
    }
```

- [ ] **Step 2: Add the /complete endpoint**

Add this method right after the `/initiate` endpoint:

```java
    @Operation(
            summary = "Complete a Stock Transfer",
            description = "Completes a stock transfer. Requires stockTransferIn and stockTransferOut to be populated. Performs actual stock movement.",
            responses = {
                    @ApiResponse(responseCode = "200", description = "Stock transfer completed successfully"),
                    @ApiResponse(responseCode = "400", description = "Invalid input - missing stockTransferIn/Out"),
                    @ApiResponse(responseCode = "404", description = "Stock transfer not found"),
                    @ApiResponse(responseCode = "500", description = "Internal server error")
            }
    )
    @PostMapping("/stockTransfer/complete")
    public Mono<ResponseEntity<StockTransfer>> completeStockTransfer(
            @RequestBody StockTransfer stockTransfer,
            @RequestHeader(value = "employeeId", required = false, defaultValue = "system") String employeeId,
            @RequestHeader(value = "employeeName", required = false, defaultValue = "System") String employeeName) {

        long start = System.currentTimeMillis();
        log.debug("Completing stock transfer: {}", stockTransfer.getId());

        // Validate: stockTransferIn and stockTransferOut must be present
        if (stockTransfer.getStockTransferIn() == null || stockTransfer.getStockTransferIn().isEmpty()) {
            return Mono.just(ResponseEntity.badRequest().build());
        }
        if (stockTransfer.getStockTransferOut() == null || stockTransfer.getStockTransferOut().isEmpty()) {
            return Mono.just(ResponseEntity.badRequest().build());
        }

        // Ensure status is Completed
        stockTransfer.setStatus("Completed");

        return stockTransferWorkflow.processStockTransferSave(stockTransfer, employeeId, employeeName)
                .map(saved -> {
                    long duration = System.currentTimeMillis() - start;
                    log.debug("Stock transfer completed in {} ms: {}", duration, saved.getId());
                    return ResponseEntity.ok(saved);
                })
                .doOnError(error -> {
                    long duration = System.currentTimeMillis() - start;
                    log.error("Error completing stock transfer after {} ms: {}", duration, error.getMessage());
                });
    }
```

- [ ] **Step 3: Compile and verify**

Run:
```bash
cd PosClientBackend && ./mvnw clean compile -DskipTests
```
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add PosClientBackend/src/main/java/com/pos/backend/feature/warehouse/WarehouseController.java
git commit -m "feat: add /stockTransfer/initiate and /stockTransfer/complete endpoints"
```

---

### Task 4: Add frontend API helper functions

**Files:**
- Modify: `PosFrontend/src/components/Helpers/apiQueries/Warehouse/StockAllocationApiHelper.js:87-96`

- [ ] **Step 1: Add initiateStockTransfer and completeStockTransfer functions**

In `StockAllocationApiHelper.js`, add these two functions right after the existing `saveStockTransfer` function (after line 96):

```javascript
export const initiateStockTransfer = async (requestData) => {
  const response = await axios.post(
    `${getClientApiServer()}/v1/api/warehouse/stockTransfer/initiate`,
    requestData,
    {
      headers: { 'Content-Type': 'application/json', 'employeeId': employeeIdHeader, 'employeeName': employeeNameHeader }
    }
  );
  return response;
};

export const completeStockTransfer = async (requestData) => {
  const response = await axios.post(
    `${getClientApiServer()}/v1/api/warehouse/stockTransfer/complete`,
    requestData,
    {
      headers: { 'Content-Type': 'application/json', 'employeeId': employeeIdHeader, 'employeeName': employeeNameHeader }
    }
  );
  return response;
};
```

- [ ] **Step 2: Commit**

```bash
git add PosFrontend/src/components/Helpers/apiQueries/Warehouse/StockAllocationApiHelper.js
git commit -m "feat: add initiateStockTransfer and completeStockTransfer API helpers"
```

---

### Task 5: Update WarehouseStore to use new endpoints

**Files:**
- Modify: `PosFrontend/src/Mobx/Stores/WarehouseStore.js:16` (import)
- Modify: `PosFrontend/src/Mobx/Stores/WarehouseStore.js:560` (API call)

- [ ] **Step 1: Update imports**

In `WarehouseStore.js`, replace line 16:

```javascript
  saveStockTransfer,
```

With:

```javascript
  saveStockTransfer,
  initiateStockTransfer,
  completeStockTransfer,
```

- [ ] **Step 2: Route to correct endpoint based on status**

In `WarehouseStore.js`, replace line 560:

```javascript
    await saveStockTransfer(InsertDoc);
```

With:

```javascript
    if (InsertDoc.status === 'Completed') {
      await completeStockTransfer(InsertDoc);
    } else {
      await initiateStockTransfer(InsertDoc);
    }
```

- [ ] **Step 3: Verify frontend builds**

Run:
```bash
cd PosFrontend && npm run build-electron 2>&1 | tail -20
```
Expected: Build completes without errors

- [ ] **Step 4: Commit**

```bash
git add PosFrontend/src/Mobx/Stores/WarehouseStore.js
git commit -m "feat: route stock transfer to /initiate or /complete based on status"
```

---

### Task 6: Build and verify full backend

**Files:** None (verification only)

- [ ] **Step 1: Full backend compile**

Run:
```bash
cd PosClientBackend && ./mvnw clean package -DskipTests
```
Expected: BUILD SUCCESS

- [ ] **Step 2: Verify new endpoints are registered**

Check the compiled output has the new endpoints by searching the class:
```bash
cd PosClientBackend && grep -r "stockTransfer/initiate\|stockTransfer/complete" src/main/java/
```
Expected: Both endpoints found in WarehouseController.java

- [ ] **Step 3: Final commit with all changes**

If any uncommitted changes remain:
```bash
git status
```
Expected: Clean working tree (all changes committed in previous tasks)
