# Business Products Edit Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a product is edited via the edit APIs, sync the updated product to all child businesses per the sync rules — without using CDC.

**Architecture:** Edit APIs (BusinessService, PosClientBackend) publish a lightweight NATS message after save. PosDockerSyncService consumes the message, checks its in-memory sync rules cache, and if a rule exists, calls mongoEventListner's new HTTP endpoint which fetches the doc, strips business-specific fields, and syncs to children.

**Tech Stack:** Java 21/24, Spring Boot, NATS JetStream, WebClient HTTP, Reactive MongoDB

**Note:** The design spec references "PosServerBackend" but the actual service handling push sync and sync rules cache is **PosDockerSyncService**. This plan uses the correct service name.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `oneshell-commons/oneshell-commons-model/.../v1/SyncRequest.java` | Shared model for NATS sync request |
| Create | `PosDockerSyncService/.../feature/syncdispatch/SyncDispatchService.java` | Cache check + HTTP dispatch to mongoEventListner |
| Create | `PosDockerSyncService/.../feature/syncdispatch/SyncRequestConsumer.java` | NATS consumer for `business.sync.request` |
| Modify | `PosDockerSyncService/.../feature/datasync/ClientSyncPushRequestConsumer.java` | Add sync dispatch after businessProducts save |
| Modify | `PosDockerSyncService/.../config/NatsConfig.java` | Add JetStream stream + consumer for sync requests |
| Create | `PosDockerSyncService/.../config/MongoEventListnerWebClient.java` | WebClient bean for mongoEventListner HTTP calls |
| Create | `mongoEventListner/.../feature/syncrules/SyncDocumentController.java` | New `POST /api/sync-ops/sync-document` endpoint |
| Create | `BusinessService/.../config/NatsConfig.java` | NATS connection for BusinessService |
| Create | `BusinessService/.../feature/products/SyncEventPublisher.java` | Publishes SyncRequest to NATS after product edit |
| Modify | `BusinessService/.../feature/products/ProductsRepository.java` | Call SyncEventPublisher after editProduct/forceEditProduct |
| Modify | `PosClientBackend/.../saga/workflows/BusinessProductsWorkflow.java` | Publish NATS sync request in Web mode |

---

### Task 1: SyncRequest Model in oneshell-commons

**Files:**
- Create: `oneshell-commons/oneshell-commons-model/src/main/java/com/oneshell/commons/server/model/v1/SyncRequest.java`

- [ ] **Step 1: Create SyncRequest model**

```java
package com.oneshell.commons.server.model.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SyncRequest {
    private String businessId;
    private String collection;
    private String documentId;
    private String action;
}
```

- [ ] **Step 2: Build and install oneshell-commons**

Run: `cd /Users/manip/Documents/codeRepo/oneshell-commons && ./mvnw clean install -DskipTests`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
cd /Users/manip/Documents/codeRepo/oneshell-commons
git add oneshell-commons-model/src/main/java/com/oneshell/commons/server/model/v1/SyncRequest.java
git commit -m "feat: add SyncRequest model for edit sync NATS messaging"
```

---

### Task 2: mongoEventListner — sync-document Endpoint

**Files:**
- Create: `mongoEventListner/src/main/java/com/oneshell/mongoeventlistener/feature/syncrules/SyncDocumentController.java`

**Reference:** Existing `SyncOpsController.java` at `mongoEventListner/src/main/java/com/oneshell/mongoeventlistener/feature/syncrules/SyncOpsController.java` for patterns.

- [ ] **Step 1: Create SyncDocumentController**

```java
package com.oneshell.mongoeventlistener.feature.syncrules;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

@RestController
@RequestMapping("/api/sync-ops")
@RequiredArgsConstructor
@Slf4j
public class SyncDocumentController {

    private final ReactiveMongoTemplate mongoTemplate;
    private final TransactionSyncRulesService syncService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Fields to strip from businessProducts before syncing to child businesses.
     * These are business-specific and should not propagate from parent to child.
     */
    private static final Set<String> BUSINESS_PRODUCTS_EXCLUDED_FIELDS = Set.of(
            "stockQty", "openingStockQty", "openingStockValue",
            "batchData", "serialData",
            "manufacturingCost", "manufacturingData", "rawMaterials"
    );

    /**
     * Sync a specific document to child businesses via sync rules.
     * Fetches the document from MongoDB, optionally strips excluded fields,
     * then applies sync rules to copy to all target businesses.
     *
     * @param collection the MongoDB collection name (e.g., "businessProducts")
     * @param documentId the _id of the document to sync
     */
    @PostMapping("/sync-document")
    public Mono<Map<String, Object>> syncDocument(
            @RequestParam String collection,
            @RequestParam String documentId) {

        log.info("SyncDocument: collection={}, documentId={}", collection, documentId);

        return mongoTemplate.findOne(
                        new Query(Criteria.where("_id").is(documentId)),
                        Document.class,
                        collection
                )
                .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Document not found: " + documentId + " in " + collection)))
                .flatMap(doc -> {
                    // Loop prevention: skip synced documents
                    if (doc.containsKey("_syncSource")) {
                        log.info("SyncDocument: Skipping synced document (has _syncSource) - collection={}, documentId={}",
                                collection, documentId);
                        return Mono.just(Map.<String, Object>of(
                                "synced", 0, "failed", 0, "skipped", 1,
                                "documentId", documentId, "collection", collection,
                                "reason", "Document has _syncSource (already synced)"
                        ));
                    }

                    try {
                        JsonNode jsonNode = objectMapper.readTree(doc.toJson());

                        // Strip excluded fields for businessProducts
                        if ("businessProducts".equals(collection) && jsonNode.isObject()) {
                            ObjectNode objectNode = (ObjectNode) jsonNode;
                            BUSINESS_PRODUCTS_EXCLUDED_FIELDS.forEach(objectNode::remove);
                            log.info("SyncDocument: Stripped {} excluded fields from businessProducts document {}",
                                    BUSINESS_PRODUCTS_EXCLUDED_FIELDS.size(), documentId);
                        }

                        AtomicInteger syncedCount = new AtomicInteger(0);

                        return syncService.applyRulesForBusiness(collection, jsonNode)
                                .doOnSuccess(result -> {
                                    if (result != null && result.isArray()) {
                                        syncedCount.set(result.size());
                                    }
                                })
                                .thenReturn(Map.<String, Object>of(
                                        "documentId", documentId,
                                        "collection", collection
                                ))
                                .map(base -> {
                                    var result = new java.util.HashMap<>(base);
                                    result.put("synced", syncedCount.get());
                                    result.put("failed", 0);
                                    result.put("skipped", 0);
                                    return (Map<String, Object>) result;
                                });

                    } catch (Exception e) {
                        log.error("SyncDocument: Failed to parse document - collection={}, documentId={}, error={}",
                                collection, documentId, e.getMessage());
                        return Mono.error(new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                                "Failed to parse document: " + e.getMessage()));
                    }
                })
                .doOnSuccess(result -> log.info("SyncDocument: completed - {}", result))
                .doOnError(e -> {
                    if (!(e instanceof ResponseStatusException)) {
                        log.error("SyncDocument: error - collection={}, documentId={}, error={}",
                                collection, documentId, e.getMessage(), e);
                    }
                });
    }
}
```

- [ ] **Step 2: Compile to verify**

Run: `cd /Users/manip/Documents/codeRepo/mongoEventListner && mvn clean compile -q`
Expected: BUILD SUCCESS (no errors)

- [ ] **Step 3: Commit**

```bash
cd /Users/manip/Documents/codeRepo/mongoEventListner
git add src/main/java/com/oneshell/mongoeventlistener/feature/syncrules/SyncDocumentController.java
git commit -m "feat: add POST /api/sync-ops/sync-document endpoint for manual edit sync"
```

---

### Task 3: PosDockerSyncService — MongoEventListner WebClient

**Files:**
- Create: `PosDockerSyncService/src/main/java/com/pos/backend/config/MongoEventListnerWebClient.java`

**Reference:** Check existing WebClient beans in `PosDockerSyncService/src/main/java/com/pos/backend/config/` for patterns.

- [ ] **Step 1: Create WebClient bean for mongoEventListner**

```java
package com.pos.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;

@Configuration
public class MongoEventListnerWebClient {

    @Value("${mongoeventlistner.host:http://mongoeventlistner.default.svc.cluster.local:8098}")
    private String mongoEventListnerHost;

    @Bean("mongoEventListnerWebClient")
    public WebClient mongoEventListnerWebClient() {
        return WebClient.builder()
                .baseUrl(mongoEventListnerHost)
                .build();
    }
}
```

- [ ] **Step 2: Add config property to application YAML files**

In `PosDockerSyncService/src/main/resources/application-qa.yaml`, add:
```yaml
mongoeventlistner:
  host: http://mongoeventlistner.default.svc.cluster.local:8098
```

In `PosDockerSyncService/src/main/resources/application-prod.yaml`, add:
```yaml
mongoeventlistner:
  host: http://mongoeventlistner.default.svc.cluster.local:8098
```

- [ ] **Step 3: Compile to verify**

Run: `cd /Users/manip/Documents/codeRepo/PosDockerSyncService && mvn clean compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
cd /Users/manip/Documents/codeRepo/PosDockerSyncService
git add src/main/java/com/pos/backend/config/MongoEventListnerWebClient.java
git add src/main/resources/application-qa.yaml src/main/resources/application-prod.yaml
git commit -m "feat: add WebClient for mongoEventListner HTTP calls"
```

---

### Task 4: PosDockerSyncService — SyncDispatchService

**Files:**
- Create: `PosDockerSyncService/src/main/java/com/pos/backend/feature/syncdispatch/SyncDispatchService.java`

**Reference:** `PosDockerSyncService/src/main/java/com/pos/backend/feature/syncrules/TransactionSyncRulesServiceImpl.java` for the `syncRulesCache` and `fetchActiveRules` patterns (lines 100, 202-222).

- [ ] **Step 1: Create SyncDispatchService**

```java
package com.pos.backend.feature.syncdispatch;

import com.oneshell.commons.server.model.v1.TransactionSyncRule;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
public class SyncDispatchService {

    private final WebClient mongoEventListnerWebClient;
    private final ReactiveMongoTemplate mongoTemplate;

    private static final long CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    private record CachedRuleExists(boolean exists, long cachedAt) {}
    private final ConcurrentHashMap<String, CachedRuleExists> ruleExistsCache = new ConcurrentHashMap<>();

    public SyncDispatchService(
            @Qualifier("mongoEventListnerWebClient") WebClient mongoEventListnerWebClient,
            ReactiveMongoTemplate mongoTemplate) {
        this.mongoEventListnerWebClient = mongoEventListnerWebClient;
        this.mongoTemplate = mongoTemplate;
    }

    /**
     * Check if an active sync rule exists for the given collection and businessId.
     * If yes, dispatch an HTTP call to mongoEventListner to sync the document.
     * Fire-and-forget — errors are logged, not propagated.
     */
    public void dispatchIfRuleExists(String collection, String businessId, String documentId) {
        if (collection == null || businessId == null || documentId == null) {
            log.warn("SyncDispatch: null parameter - collection={}, businessId={}, documentId={}",
                    collection, businessId, documentId);
            return;
        }

        String cacheKey = collection + ":" + businessId;
        CachedRuleExists cached = ruleExistsCache.get(cacheKey);

        if (cached != null && (System.currentTimeMillis() - cached.cachedAt()) < CACHE_TTL_MS) {
            if (!cached.exists()) {
                log.debug("SyncDispatch: cache hit, no rule exists for {} - skipping", cacheKey);
                return;
            }
            // Rule exists in cache — dispatch directly
            dispatchToMongoEventListner(collection, documentId, cacheKey);
            return;
        }

        // Cache miss or expired — query MongoDB
        checkRuleExistsAndDispatch(collection, businessId, documentId, cacheKey);
    }

    private void checkRuleExistsAndDispatch(String collection, String businessId, String documentId, String cacheKey) {
        Query query = new Query(Criteria.where("transactionType").is(collection)
                .and("fromBusinessId").is(businessId)
                .and("active").is(true));

        mongoTemplate.exists(query, "transactionSyncRules")
                .timeout(Duration.ofSeconds(5))
                .doOnNext(exists -> {
                    ruleExistsCache.put(cacheKey, new CachedRuleExists(exists, System.currentTimeMillis()));
                    if (exists) {
                        dispatchToMongoEventListner(collection, documentId, cacheKey);
                    } else {
                        log.debug("SyncDispatch: no active rule for {} - skipping", cacheKey);
                    }
                })
                .doOnError(e -> log.error("SyncDispatch: failed to check rules for {} - {}", cacheKey, e.getMessage()))
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe();
    }

    private void dispatchToMongoEventListner(String collection, String documentId, String cacheKey) {
        log.info("SyncDispatch: dispatching to mongoEventListner - collection={}, documentId={}", collection, documentId);

        mongoEventListnerWebClient.post()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/sync-ops/sync-document")
                        .queryParam("collection", collection)
                        .queryParam("documentId", documentId)
                        .build())
                .retrieve()
                .bodyToMono(Map.class)
                .timeout(Duration.ofSeconds(30))
                .doOnSuccess(result -> log.info("SyncDispatch: completed - collection={}, documentId={}, result={}",
                        collection, documentId, result))
                .doOnError(e -> log.error("SyncDispatch: HTTP call failed - collection={}, documentId={}, error={}",
                        collection, documentId, e.getMessage()))
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe();
    }
}
```

- [ ] **Step 2: Compile to verify**

Run: `cd /Users/manip/Documents/codeRepo/PosDockerSyncService && mvn clean compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
cd /Users/manip/Documents/codeRepo/PosDockerSyncService
git add src/main/java/com/pos/backend/feature/syncdispatch/SyncDispatchService.java
git commit -m "feat: add SyncDispatchService for cache-check and HTTP dispatch to mongoEventListner"
```

---

### Task 5: PosDockerSyncService — SyncRequestConsumer (NATS)

**Files:**
- Create: `PosDockerSyncService/src/main/java/com/pos/backend/feature/syncdispatch/SyncRequestConsumer.java`
- Modify: `PosDockerSyncService/src/main/java/com/pos/backend/config/NatsConfig.java`

**Reference:** `PosDockerSyncService/src/main/java/com/pos/backend/feature/datasync/ClientSyncPushRequestConsumer.java` for NATS consumer patterns.

- [ ] **Step 1: Add JetStream stream + consumer config to NatsConfig**

Add the following to `PosDockerSyncService/src/main/java/com/pos/backend/config/NatsConfig.java` after the existing `remoteNatsConnection()` bean:

```java
@Bean
public JetStream jetStream(Connection remoteNatsConnection) throws Exception {
    JetStreamManagement jsm = remoteNatsConnection.jetStreamManagement();

    // Create sync-request-stream if it doesn't exist
    try {
        jsm.getStreamInfo("sync-request-stream");
        log.info("JetStream stream 'sync-request-stream' already exists");
    } catch (Exception e) {
        StreamConfiguration streamConfig = StreamConfiguration.builder()
                .name("sync-request-stream")
                .subjects("business.sync.request")
                .retentionPolicy(RetentionPolicy.WorkQueue)
                .maxAge(Duration.ofDays(7))
                .storageType(StorageType.File)
                .build();
        jsm.addStream(streamConfig);
        log.info("Created JetStream stream 'sync-request-stream'");
    }

    return remoteNatsConnection.jetStream();
}
```

Add imports at the top of `NatsConfig.java`:
```java
import io.nats.client.JetStream;
import io.nats.client.JetStreamManagement;
import io.nats.client.api.RetentionPolicy;
import io.nats.client.api.StorageType;
import io.nats.client.api.StreamConfiguration;
```

- [ ] **Step 2: Create SyncRequestConsumer**

```java
package com.pos.backend.feature.syncdispatch;

import com.oneshell.commons.server.model.v1.SyncRequest;
import io.nats.client.*;
import io.nats.client.api.ConsumerConfiguration;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
@Slf4j
public class SyncRequestConsumer {

    private final JetStream jetStream;
    private final Connection natsConnection;
    private final SyncDispatchService syncDispatchService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final ExecutorService pollingExecutor = Executors.newSingleThreadExecutor(
            r -> { Thread t = new Thread(r, "sync-request-poller"); t.setDaemon(true); return t; });

    private static final String STREAM_NAME = "sync-request-stream";
    private static final String CONSUMER_NAME = "sync-request-consumer";
    private static final String SUBJECT = "business.sync.request";
    private static final int BATCH_SIZE = 10;
    private static final Duration POLL_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration POLL_INTERVAL = Duration.ofSeconds(2);

    public SyncRequestConsumer(JetStream jetStream, Connection natsConnection,
                               SyncDispatchService syncDispatchService) {
        this.jetStream = jetStream;
        this.natsConnection = natsConnection;
        this.syncDispatchService = syncDispatchService;
    }

    @PostConstruct
    public void start() {
        running.set(true);
        pollingExecutor.submit(this::pollLoop);
        log.info("SyncRequestConsumer started - polling {} stream", STREAM_NAME);
    }

    @PreDestroy
    public void stop() {
        running.set(false);
        pollingExecutor.shutdown();
        try {
            if (!pollingExecutor.awaitTermination(30, TimeUnit.SECONDS)) {
                pollingExecutor.shutdownNow();
            }
        } catch (InterruptedException e) {
            pollingExecutor.shutdownNow();
            Thread.currentThread().interrupt();
        }
        log.info("SyncRequestConsumer stopped");
    }

    private void pollLoop() {
        JetStreamSubscription subscription = null;
        try {
            ConsumerConfiguration cc = ConsumerConfiguration.builder()
                    .durable(CONSUMER_NAME)
                    .filterSubject(SUBJECT)
                    .ackWait(Duration.ofSeconds(30))
                    .maxDeliver(3)
                    .build();

            PullSubscribeOptions pullOptions = PullSubscribeOptions.builder()
                    .stream(STREAM_NAME)
                    .configuration(cc)
                    .build();

            subscription = jetStream.subscribe(SUBJECT, pullOptions);
            log.info("SyncRequestConsumer subscribed to {} with durable consumer {}", SUBJECT, CONSUMER_NAME);

            while (running.get()) {
                try {
                    var messages = subscription.fetch(BATCH_SIZE, POLL_TIMEOUT);
                    for (Message msg : messages) {
                        processMessage(msg);
                    }
                    if (messages.isEmpty()) {
                        Thread.sleep(POLL_INTERVAL.toMillis());
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                } catch (Exception e) {
                    log.error("SyncRequestConsumer: error in poll loop - {}", e.getMessage(), e);
                    try { Thread.sleep(5000); } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        } catch (Exception e) {
            log.error("SyncRequestConsumer: failed to start - {}", e.getMessage(), e);
        }
    }

    private void processMessage(Message msg) {
        try {
            String data = new String(msg.getData());
            SyncRequest request = objectMapper.readValue(data, SyncRequest.class);

            String traceId = msg.getHeaders() != null ? msg.getHeaders().getFirst("traceId") : "unknown";
            log.info("SyncRequestConsumer: received - traceId={}, collection={}, businessId={}, documentId={}",
                    traceId, request.getCollection(), request.getBusinessId(), request.getDocumentId());

            syncDispatchService.dispatchIfRuleExists(
                    request.getCollection(),
                    request.getBusinessId(),
                    request.getDocumentId()
            );

            msg.ack();
        } catch (Exception e) {
            log.error("SyncRequestConsumer: failed to process message - {}", e.getMessage(), e);
            msg.ack(); // ACK to prevent infinite retry — error is logged
        }
    }
}
```

- [ ] **Step 3: Compile to verify**

Run: `cd /Users/manip/Documents/codeRepo/PosDockerSyncService && mvn clean compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
cd /Users/manip/Documents/codeRepo/PosDockerSyncService
git add src/main/java/com/pos/backend/feature/syncdispatch/SyncRequestConsumer.java
git add src/main/java/com/pos/backend/config/NatsConfig.java
git commit -m "feat: add SyncRequestConsumer for NATS business.sync.request subject"
```

---

### Task 6: PosDockerSyncService — Hook into ClientSyncPushRequestConsumer (Docker mode)

**Files:**
- Modify: `PosDockerSyncService/src/main/java/com/pos/backend/feature/datasync/ClientSyncPushRequestConsumer.java` (lines 154-158)

- [ ] **Step 1: Inject SyncDispatchService**

Add to the class fields (after line 30):
```java
private final SyncDispatchService syncDispatchService;
```

Update the `@RequiredArgsConstructor`-injected constructor will auto-include it.

- [ ] **Step 2: Add sync dispatch after successful businessProducts processing**

In `processRequest()` method, modify the `.then(Mono.defer(...))` block at lines 156-158. After the success response is built, add a sync dispatch call:

Replace:
```java
.then(Mono.defer(() -> {
    log.debug("===>>> [INSTANCE-{}] SYNC COMPLETED: table={}, action={}, itemId={} - Sending success response", INSTANCE_ID, finalTableName, finalAction, finalItemId);
    return Mono.just("SUCCESS:Processed message successfully for table: " + finalTableName);
}))
```

With:
```java
.then(Mono.defer(() -> {
    log.debug("===>>> [INSTANCE-{}] SYNC COMPLETED: table={}, action={}, itemId={} - Sending success response", INSTANCE_ID, finalTableName, finalAction, finalItemId);

    // Dispatch edit sync to child businesses for businessProducts
    if ("businessProducts".equals(finalTableName) && finalBusinessId != null && finalItemId != null) {
        syncDispatchService.dispatchIfRuleExists("businessProducts", finalBusinessId, finalItemId);
    }

    return Mono.just("SUCCESS:Processed message successfully for table: " + finalTableName);
}))
```

- [ ] **Step 3: Compile to verify**

Run: `cd /Users/manip/Documents/codeRepo/PosDockerSyncService && mvn clean compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
cd /Users/manip/Documents/codeRepo/PosDockerSyncService
git add src/main/java/com/pos/backend/feature/datasync/ClientSyncPushRequestConsumer.java
git commit -m "feat: dispatch businessProducts edit sync after Docker push save"
```

---

### Task 7: BusinessService — NATS Configuration + SyncEventPublisher

**Files:**
- Create: `BusinessService/src/main/java/com/oneshell/business/application/config/NatsConfig.java`
- Create: `BusinessService/src/main/java/com/oneshell/business/application/feature/products/SyncEventPublisher.java`

**Reference:** `PosDockerSyncService/src/main/java/com/pos/backend/config/NatsConfig.java` for NATS connection pattern. Check `BusinessService/pom.xml` to see if NATS dependency exists — if not, add it.

- [ ] **Step 1: Add NATS dependency to BusinessService pom.xml (if not already present)**

Add to `BusinessService/pom.xml` dependencies:
```xml
<dependency>
    <groupId>io.nats</groupId>
    <artifactId>jnats</artifactId>
    <version>2.20.2</version>
</dependency>
```

- [ ] **Step 2: Create NatsConfig**

```java
package com.oneshell.business.application.config;

import io.nats.client.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

@Configuration
@Slf4j
public class NatsConfig {

    @Value("${nats.remote.url:nats://nats-server.pos.svc.cluster.local:4222}")
    private String natsServerUrl;

    @Bean
    public Connection natsConnection() throws Exception {
        Options options = new Options.Builder()
                .server(natsServerUrl)
                .maxReconnects(-1)
                .reconnectWait(Duration.ofSeconds(2))
                .connectionTimeout(Duration.ofSeconds(10))
                .pingInterval(Duration.ofSeconds(30))
                .errorListener(new ErrorListener() {
                    @Override
                    public void errorOccurred(Connection conn, String error) {
                        log.error("NATS error: {}", error);
                    }
                    @Override
                    public void exceptionOccurred(Connection conn, Exception exp) {
                        log.error("NATS exception: {}", exp.getMessage(), exp);
                    }
                    @Override
                    public void slowConsumerDetected(Connection conn, Consumer consumer) {
                        log.warn("NATS slow consumer detected");
                    }
                    @Override
                    public void messageDiscarded(Connection conn, Message msg) {
                        log.error("NATS message discarded");
                    }
                })
                .connectionListener((conn, type) -> log.info("NATS event: {}", type))
                .build();

        Connection connection = Nats.connect(options);
        log.info("NATS connected: {}", connection.getConnectedUrl());
        return connection;
    }

    @Bean
    public JetStream jetStream(Connection natsConnection) throws Exception {
        return natsConnection.jetStream();
    }
}
```

- [ ] **Step 3: Create SyncEventPublisher**

```java
package com.oneshell.business.application.feature.products;

import com.oneshell.commons.server.model.v1.SyncRequest;
import io.nats.client.JetStream;
import io.nats.client.api.PublishAck;
import io.nats.client.impl.Headers;
import io.nats.client.impl.NatsMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class SyncEventPublisher {

    private final JetStream jetStream;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String SUBJECT = "business.sync.request";

    /**
     * Publish a sync request to NATS for a product edit.
     * Fire-and-forget — logs warning on failure, never throws.
     */
    public void publishProductEditSync(String businessId, String documentId) {
        try {
            SyncRequest request = SyncRequest.builder()
                    .businessId(businessId)
                    .collection("businessProducts")
                    .documentId(documentId)
                    .action("Edit")
                    .build();

            String json = objectMapper.writeValueAsString(request);
            String traceId = UUID.randomUUID().toString();

            Headers headers = new Headers();
            headers.add("traceId", traceId);

            NatsMessage message = NatsMessage.builder()
                    .subject(SUBJECT)
                    .headers(headers)
                    .data(json.getBytes())
                    .build();

            PublishAck ack = jetStream.publish(message);
            log.info("SyncEventPublisher: published edit sync - businessId={}, documentId={}, traceId={}, seq={}",
                    businessId, documentId, traceId, ack.getSeqno());

        } catch (Exception e) {
            log.warn("SyncEventPublisher: failed to publish edit sync - businessId={}, documentId={}, error={}",
                    businessId, documentId, e.getMessage());
        }
    }
}
```

- [ ] **Step 4: Add NATS URL to BusinessService application YAML**

Add to the QA and Prod application YAML files:
```yaml
nats:
  remote:
    url: nats://nats-server.pos.svc.cluster.local:4222
```

- [ ] **Step 5: Compile to verify**

Run: `cd /Users/manip/Documents/codeRepo/BusinessService && ./mvnw clean compile -DskipTests`
Expected: BUILD SUCCESS

- [ ] **Step 6: Commit**

```bash
cd /Users/manip/Documents/codeRepo/BusinessService
git add pom.xml
git add src/main/java/com/oneshell/business/application/config/NatsConfig.java
git add src/main/java/com/oneshell/business/application/feature/products/SyncEventPublisher.java
git commit -m "feat: add NATS config and SyncEventPublisher for product edit sync"
```

---

### Task 8: BusinessService — Hook into editProduct/forceEditProduct

**Files:**
- Modify: `BusinessService/src/main/java/com/oneshell/business/application/feature/products/ProductsRepository.java` (lines ~1223 and ~2067)

- [ ] **Step 1: Inject SyncEventPublisher into ProductsRepository**

Add field:
```java
private final SyncEventPublisher syncEventPublisher;
```

- [ ] **Step 2: Add sync publish after editProduct save**

In `editProduct()` method, after the `mongoDbProductService.saveProduct(mongoDbBusinessProduct)` call (around line 2028), add:

```java
// Trigger edit sync to child businesses
syncEventPublisher.publishProductEditSync(
        mongoDbBusinessProduct.getBusinessId(),
        mongoDbBusinessProduct.getId()
);
```

- [ ] **Step 3: Verify forceEditProduct coverage**

`forceEditProduct()` (line 2067) calls `editProduct()` internally (line 2089), so the sync publish added in Step 2 covers both endpoints. No separate change needed for forceEditProduct.

- [ ] **Step 4: Compile to verify**

Run: `cd /Users/manip/Documents/codeRepo/BusinessService && ./mvnw clean compile -DskipTests`
Expected: BUILD SUCCESS

- [ ] **Step 5: Commit**

```bash
cd /Users/manip/Documents/codeRepo/BusinessService
git add src/main/java/com/oneshell/business/application/feature/products/ProductsRepository.java
git commit -m "feat: publish NATS sync event after product edit in BusinessService"
```

---

### Task 9: PosClientBackend — Publish Sync in Web Mode

**Files:**
- Modify: `PosClientBackend/src/main/java/com/pos/backend/saga/workflows/BusinessProductsWorkflow.java` (lines 514-534, SYNC_TO_REMOTE step)

**Reference:** PosClientBackend already has NATS configured at `PosClientBackend/src/main/java/com/pos/backend/config/NatsConfig.java`. It has `localJetStream` bean for local NATS. However, for Web mode, we need to publish to the **remote** NATS (same as PosDockerSyncService uses). Check if PosClientBackend has a remote NATS connection — if not, we use the existing `PosServerBackendService.publishToRemoteServer()` pattern or add a remote JetStream bean.

- [ ] **Step 1: Check PosClientBackend NATS config for remote connection**

Read `PosClientBackend/src/main/java/com/pos/backend/config/NatsConfig.java` and check if there's a remote NATS connection bean. If only local NATS exists, add a remote JetStream bean for Web mode publishing.

- [ ] **Step 2: Create SyncEventPublisher in PosClientBackend**

Create `PosClientBackend/src/main/java/com/pos/backend/feature/businessProduct/SyncEventPublisher.java` with the same pattern as the BusinessService version (Task 7 Step 3), using the remote JetStream bean.

- [ ] **Step 3: Modify BusinessProductsWorkflow SYNC_TO_REMOTE step**

In `syncToRemote()` method (line 514), the current logic is:
- If `featureToggleService.isCalculateStockAndBalanceEnabled()` returns TRUE → Web mode → currently does nothing
- If FALSE → Docker mode → publishes via `posServerBackendService.publishToRemoteServer()`

Add Web mode handling: when Web mode is active, call `syncEventPublisher.publishProductEditSync(businessProduct.getBusinessId(), businessProduct.getId())`.

```java
private void syncToRemote(BusinessProduct businessProduct) {
    if (featureToggleService.isCalculateStockAndBalanceEnabled()) {
        // Web mode — publish sync request to NATS for child business sync
        syncEventPublisher.publishProductEditSync(
                businessProduct.getBusinessId(),
                businessProduct.getId()
        );
    } else {
        // Docker mode — push to PosServerBackend via existing NATS flow
        posServerBackendService.publishToRemoteServer(businessProduct, "businessProducts", "Save")
                .subscribeOn(Schedulers.boundedElastic())
                .doOnSuccess(result -> log.info("Sync to remote: {}", result))
                .doOnError(error -> log.error("Sync to remote failed: {}", error.getMessage()))
                .subscribe();
    }
}
```

- [ ] **Step 4: Compile to verify**

Run: `cd /Users/manip/Documents/codeRepo/PosClientBackend && ./mvnw clean compile -DskipTests`
Expected: BUILD SUCCESS

- [ ] **Step 5: Commit**

```bash
cd /Users/manip/Documents/codeRepo/PosClientBackend
git add src/main/java/com/pos/backend/feature/businessProduct/SyncEventPublisher.java
git add src/main/java/com/pos/backend/saga/workflows/BusinessProductsWorkflow.java
git commit -m "feat: publish NATS sync event in Web mode after product edit"
```

---

### Task 10: Deploy to QA and Test All Flows

**Services to deploy (push to master):**
- oneshell-commons (already installed locally, push to trigger rebuild)
- mongoEventListner
- PosDockerSyncService
- BusinessService
- PosClientBackend

**Test Flow 1: mongoEventListner endpoint directly**

- [ ] **Step 1: Port-forward and test sync-document endpoint**

```bash
kubectl port-forward svc/mongoeventlistner 8098:8098 -n default --insecure-skip-tls-verify --kubeconfig .qa-kubeconfig &

# Find a businessProducts doc in a business that has sync rules
kubectl exec -n mongodb qa-cluster-mongos-0 --insecure-skip-tls-verify --kubeconfig .qa-kubeconfig -- mongosh \
  'mongodb://databaseAdmin:Mg%239vB%40kN3wQ5z@localhost:27017/oneshell?authSource=admin' \
  --quiet --eval '
var rule = db.transactionSyncRules.findOne({ transactionType: "businessProducts", active: true });
if (rule) {
  var doc = db.businessProducts.findOne({ businessId: rule.fromBusinessId, deleted: { $ne: true } });
  if (doc) print("Test doc: _id=" + doc._id + " businessId=" + doc.businessId);
  else print("No product found for " + rule.fromBusinessId);
} else print("No businessProducts rule found");
'

# Call the endpoint
curl -X POST "http://localhost:8098/api/sync-ops/sync-document?collection=businessProducts&documentId=DOCUMENT_ID"
```

Expected: JSON response with `synced > 0`

**Test Flow 2: NATS → PosDockerSyncService → mongoEventListner**

- [ ] **Step 2: Publish a test NATS message and verify end-to-end**

```bash
# Insert a test product in a parent business that has sync rules
kubectl exec -n mongodb qa-cluster-mongos-0 --insecure-skip-tls-verify --kubeconfig .qa-kubeconfig -- mongosh \
  'mongodb://databaseAdmin:Mg%239vB%40kN3wQ5z@localhost:27017/oneshell?authSource=admin' \
  --quiet --eval '
var testId = "test_edit_sync_" + Date.now();
db.businessProducts.insertOne({
  _id: testId, productId: testId, name: "TEST_EDIT_SYNC",
  businessId: "FROM_BUSINESS_ID", businessCity: "TestCity",
  deleted: false, stockQty: 100, batchData: [{batch: "B1"}],
  updatedAt: NumberLong(String(Date.now())),
  _class: "com.oneshell.commons.client.model.v1.MongoDbBusinessProduct"
});
print("Inserted: " + testId);
'

# Verify sync-document strips stockQty and batchData
curl -X POST "http://localhost:8098/api/sync-ops/sync-document?collection=businessProducts&documentId=TEST_ID"
```

Verify in target business: synced doc should NOT have `stockQty` or `batchData` fields.

- [ ] **Step 3: Verify update scenario**

Update the test product in the parent business, call sync-document again, and verify the synced copy in the child business was overwritten with the new data.

- [ ] **Step 4: Clean up test data**

```bash
kubectl exec -n mongodb qa-cluster-mongos-0 --insecure-skip-tls-verify --kubeconfig .qa-kubeconfig -- mongosh \
  'mongodb://databaseAdmin:Mg%239vB%40kN3wQ5z@localhost:27017/oneshell?authSource=admin' \
  --quiet --eval 'db.businessProducts.deleteMany({ _id: { $regex: "^test_edit_sync_" } })'
```
