# Business Products Edit Sync — Design Spec

**Date:** 2026-03-28
**Status:** Approved

## Problem

businessProducts gets frequent updates (stock, batches, manufacturing) that should NOT trigger sync to child businesses. However, when a genuine product edit happens via the edit APIs, the updated product should be copied to all child businesses per the sync rules.

Currently, businessProducts CDC is insert-only (Debezium `skipped.operations: "u,d"`). There is no mechanism to sync edits from parent to child businesses.

## Solution

Manual sync triggering from the edit APIs via NATS, with PosServerBackend as a gatekeeper (cache-checks sync rules) and mongoEventListner as the sync executor.

## APIs That Trigger Sync

| API | Service | Namespace |
|-----|---------|-----------|
| `POST /v1/business/products/editProduct` | BusinessService | default |
| `POST /v1/business/products/forceEditProduct` | BusinessService | default |
| `POST /v1/api/businessProducts` (save/update) | PosClientBackend Web mode | pos |
| Push sync via `business.push.request` | PosClientBackend Docker mode (via PosServerBackend) | default |

## Data Flow

### Flow 1: BusinessService & PosClientBackend Web Mode

```
BusinessService or PosClientBackend (Web mode)
  | saves product to MongoDB
  | publishes to NATS: business.sync.request
  | payload: {businessId, collection, documentId, action}
  v
NATS JetStream (stream: sync-request-stream, subject: business.sync.request)
  v
PosServerBackend - SyncRequestConsumer (queue: pos-server-sync-queue)
  | 1. Parse: {businessId, collection, documentId}
  | 2. Cache check: active rule for (collection, businessId)?
  | 3. No rule -> ACK and skip
  | 4. Rule exists -> HTTP POST to mongoEventListner
  v
mongoEventListner - POST /api/sync-ops/sync-document?collection=businessProducts&documentId=X
  | 1. Fetch full doc from MongoDB by _id
  | 2. Skip if _syncSource present (loop prevention)
  | 3. Strip excluded fields (stock, batch, manufacturing)
  | 4. applyRulesForBusiness(collection, doc) with upsert
  v
Target business documents updated
```

### Flow 2: PosClientBackend Docker Mode

```
PosClientBackend Docker
  | saves locally, publishes to NATS: business.push.request (existing)
  v
PosServerBackend - ClientSyncPushRequestConsumer (existing)
  | saves to MongoDB via MongoDbService (existing)
  | -- NEW: after successful businessProducts save --
  | calls SyncDispatchService.dispatchIfRuleExists(collection, businessId, documentId)
  v
SyncDispatchService
  | cache check -> if rule exists -> HTTP POST to mongoEventListner
  v
mongoEventListner - same endpoint as Flow 1
```

## Component Changes

### 1. oneshell-commons (shared model)

New class `SyncRequest`:
```java
public class SyncRequest {
    private String businessId;
    private String collection;
    private String documentId;
    private String action; // "Edit", "Save"
}
```

### 2. BusinessService (publisher)

**Touch points:**
- `ProductsRepository.editProduct()` — after `mongoDbProductService.saveProduct()` succeeds, publish SyncRequest to NATS `business.sync.request`
- `ProductsRepository.forceEditProduct()` — same

**Behavior:** Fire-and-forget. NATS publish failure logs a warning but does not fail the edit API response.

### 3. PosClientBackend Web Mode (publisher)

**Touch point:**
- `BusinessProductsWorkflow` SAGA — in `SYNC_TO_REMOTE` step, when Web mode is active, publish SyncRequest to NATS `business.sync.request`

**Behavior:** Fire-and-forget. Only in Web mode (Docker mode uses existing push sync path).

### 4. PosServerBackend (gatekeeper)

**New: `SyncRequestConsumer`**
- NATS consumer on `business.sync.request`, queue group `pos-server-sync-queue`
- Calls `SyncDispatchService.dispatchIfRuleExists()`

**Modified: `ClientSyncPushRequestConsumer`**
- After successful businessProducts save, calls `SyncDispatchService.dispatchIfRuleExists()`

**New: `SyncDispatchService`**
- Shared helper used by both consumers
- Checks in-memory `syncRulesCache` (existing, 5min TTL) for active rule matching `(collection, businessId)`
- If rule exists: HTTP POST to `http://mongoeventlistner.default.svc:8098/api/sync-ops/sync-document?collection={collection}&documentId={documentId}`
- Fire-and-forget with error logging

### 5. mongoEventListner (sync executor)

**New endpoint: `POST /api/sync-ops/sync-document`**

Parameters:
- `collection` (required) — e.g., "businessProducts"
- `documentId` (required) — the `_id` of the document

Logic:
1. Fetch full document from MongoDB by `_id` in the given collection
2. Return 404 if not found
3. Skip if `_syncSource` present (loop prevention)
4. **For businessProducts: strip excluded fields** (see below)
5. Call `applyRulesForBusiness(collection, cleanDoc)` with upsert semantics
6. Return summary: `{synced: N, failed: N, skipped: N}`

## Field Exclusions for businessProducts

When the `sync-document` endpoint processes `businessProducts`, these fields are stripped from the document **before** syncing to child businesses:

- **Stock:** `stockQty`, `openingStockQty`, `openingStockValue`
- **Batch:** `batchData`, `serialData`
- **Manufacturing:** `manufacturingCost`, `manufacturingData`, `rawMaterials`

This stripping happens only in the `sync-document` endpoint, not in other sync paths (CDC insert, full sync).

## NATS Configuration

| Setting | Value |
|---------|-------|
| Subject | `business.sync.request` |
| Stream | `sync-request-stream` |
| Retention | WorkQueue |
| Max age | 7 days |
| Storage | File |
| Consumer | `sync-request-consumer` (durable) |
| Queue group | `pos-server-sync-queue` |
| ACK wait | 30 seconds |
| Max delivery | 3 |

**Message format:**
```json
{
  "businessId": "b117386657779931",
  "collection": "businessProducts",
  "documentId": "prod_abc123",
  "action": "Edit"
}
```

**Headers:** `traceId` (UUID)

**Deduplication:** Not needed — sync is idempotent (upsert overwrites with same data).

## Error Handling

| Component | On Failure | Behavior |
|-----------|-----------|----------|
| BusinessService / PosClientBackend | NATS publish fails | Log warning, don't fail edit API |
| PosServerBackend consumer | Cache check fails (MongoDB down) | NAK for retry |
| PosServerBackend consumer | HTTP to mongoEventListner fails | NAK for retry (up to 3) |
| PosServerBackend consumer | Max retries exceeded | ACK, log to changeStreamEventErrors |
| mongoEventListner | Document not found | Return 404, PosServerBackend ACKs |
| mongoEventListner | Sync to target fails | Continue with remaining targets, log failures |

## Observability

All components log `traceId` from NATS headers for end-to-end tracing.

mongoEventListner returns sync summary per request:
```json
{"synced": 3, "failed": 0, "skipped": 1, "documentId": "X", "collection": "businessProducts"}
```
