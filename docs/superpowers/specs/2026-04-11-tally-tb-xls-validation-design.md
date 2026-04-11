# Tally Trial Balance XLS Validation — Design Spec

**Date:** 2026-04-11
**Status:** Approved for planning
**Services:** PosDataSyncService (PDS), TallyConnector (TC)

## Goal

Let a TallyConnector user upload a `TrialBal.xlsx` exported from Tally, have PosDataSyncService parse and compare it against the OnShell trial balance for the selected business and financial year, and display the differences in the TallyConnector dashboard as an expandable ledger-wise tree (like the OnShell trial balance UI).

All parsing, balance computation, matching, and tree building are performed in PDS. TallyConnector is a thin UI that uploads the file and renders the tree response.

## Non-goals

- Automated comparison on a schedule (manual upload only)
- Comparison of Parties (Sundry Debtor/Creditor leaves stored as Parties in OnShell)
- Editable tolerance / configurable thresholds
- PDF or CSV upload formats (only `.xlsx`)
- Persisting validation results in MongoDB
- Replacing the existing `/trial-balance/validate` endpoint or the `compare-tb-full.py` script

## Current state (what already exists)

**PosDataSyncService v1.1.82**
- `POST /api/v1/data/tally-ingest/trial-balance/validate` (`TallyIngestController`) accepts `TrialBalanceValidationRequest` with a **pre-parsed** `tallyLedgers` list. It only compares **closing balance**, returns a **flat** `LedgerComparison` list, and handles `MATCH / MISMATCH / TALLY_ONLY / ONESHELL_ONLY` statuses. Service: `TrialBalanceValidationService`.
- Balance computation: fetches `chartOfAccounts` and `allTransactions` via `MongoDbServiceClient`, sums by coaId from `ledgers[]` and `ledgerData` (for Ledger Opening Balance txnType).

**TallyConnector v1.1.57**
- Dashboard at `src/main/resources/static/index.html` (~1,381 lines). Has existing sections for sync status, replay, XML file upload, XML preview. No trial balance validation UI.

**compare-tb-full.py** (`TallyConnector/scripts/compare-tb-full.py`)
- Python reference: parses `TrialBal.xlsx`, compares against the real PosClientBackend trial balance JSON, compares OB + Nett + Closing with `TOLERANCE = 1.0`, skips 7 Tally virtual accounts, maps `Opening Stock → Stock-in-Hand`, handles duplicate names by closest-closing match. The parsing and matching logic here is the canonical algorithm we're porting to Java.

**Known constraint from CLAUDE.md memory**: OnShell's PosClientBackend excludes Opening Balance for accounts under Income/Expenses roots. PDS's balance computation here **does not replicate that exclusion** — we surface the resulting OB mismatch as a MISMATCH with a `note` field so the difference is visible, not hidden.

## Architecture

```
TallyConnector (browser UI)
  │  Dashboard panel: "Validate Trial Balance (XLS)"
  │  User picks FY dropdown, selects TrialBal.xlsx, clicks Validate
  │
  │  multipart/form-data POST
  │     file=<TrialBal.xlsx>, fromDate=20250401, toDate=20260331
  │
  ▼
PosDataSyncService
  TallyIngestController.validateTrialBalanceExcel()
     │
     ▼
  TrialBalanceExcelValidationService
     (1) TrialBalanceExcelParser — Apache POI, auto-detect OB/Nett/Closing columns
     (2) MongoDbServiceClient: fetch COA + allTransactions (parallel Mono.zip)
     (3) Compute per-leaf OB, periodDebit, periodCredit, Nett, Closing
     (4) Build OnShell COA hierarchy tree, roll up group totals bottom-up
     (5) Overlay Tally rows by case-insensitive name match; duplicates → closest closing
     (6) Bucket Tally virtual accounts; apply name mappings
     (7) Compute per-node status + per-field ok flags; summary counts
     │
     ▼
  TrialBalanceExcelValidationResponse { parseInfo, summary, tree, virtualAccounts, tallyOnly }

  ◄── JSON
TallyConnector UI
  Renders expandable tree, roots collapsed by default
```

**Unit boundaries:**
- `TrialBalanceExcelParser` is pure (`byte[] → ParseResult`). Unit-testable without Spring.
- `TrialBalanceExcelValidationService` is Spring-managed but its pipeline is deterministic given a fixed `MongoDbServiceClient` mock.
- `TallyIngestController` is the only reactive/multipart seam.
- No changes to `oneshell-commons`. No changes to existing `TrialBalanceValidationService`.

## Components

### PDS — new code

All new code lives in `PosDataSyncService`:
- Package `com.oneshell.service.tally.tbexcel` — parser + service
- Package `com.oneshell.model.tally.ingest` — DTOs (alongside existing trial-balance DTOs)

#### 1. `TrialBalanceExcelParser` (pure utility)

```java
public class TrialBalanceExcelParser {
  public enum Layout { OB_NETT_CLOSING, NETT_CLOSING }

  public ParseResult parse(byte[] xlsxBytes, String originalFilename)
      throws TrialBalanceParseException;

  public record TallyRow(
      String name, double ob, double nett, double closing, int excelRowNum) {}

  public record ParseInfo(
      int totalRowsInSheet, int dataRowsParsed, int skippedBlank,
      Layout detectedLayout, String obColumn, String nettColumn, String closingColumn,
      boolean grandTotalFound) {}

  public record ParseResult(List<TallyRow> rows, ParseInfo parseInfo) {}
}
```

Header detection mirrors `compare-tb-full.py`: scan rows 1–20, column B, for `"Opening Balance"` or `"Nett"` labels. `data_start = headerRow + 2`. Columns are positional: A=name, then B=OB + D=Nett + F=Closing **or** B=Nett + D=Closing when OB is absent.

Throws `TrialBalanceParseException` on:
- Unreadable workbook (wraps POI `IOException`/`InvalidFormatException`)
- No header label found in first 20 rows of column B
- Empty sheet after header row

#### 2. `TrialBalanceExcelValidationService` (Spring `@Service`)

```java
@Service
@RequiredArgsConstructor
public class TrialBalanceExcelValidationService {
  private final MongoDbServiceClient mongoDbClient;
  private final TrialBalanceExcelParser parser;

  public Mono<TrialBalanceExcelValidationResponse> validate(
      byte[] xlsxBytes, String originalFilename,
      String fromDate, String toDate,
      String businessId, String businessCity);
}
```

**Pipeline:**

1. Parse XLSX on `Schedulers.boundedElastic()` — POI is blocking
2. `Mono.zip(fetchCOA, fetchAllTransactions)`
3. Build COA maps from the COA list:
   - `idToName`, `idToParentId`, `idToIsLastLevel`, `idToChildren`
   - Use both `_id` **and** `chartOfAccountId` for keying (per CLAUDE memory: dual-ID rule)
4. Compute per-coaId `{openingBalance, periodDebit, periodCredit}` from allTransactions:
   - `Ledger Opening Balance` txnType → `ledgerData.chartOfAccountId`, sign from `ledgerData.credit`, amount from `amount`
   - Regular txnType → filter by `date >= fromMillis AND date <= toMillis`, iterate `ledgers[]`, read `chartOfAccountId`, split into debit/credit by `ledgers[].type`
5. Build tree bottom-up:
   - Find root nodes (no `parentId` or `parentId` not in map)
   - Recurse children. For each leaf (`isLastLevel=true`), attach OnShell OB/Nett/Closing from step 4
   - For each group, roll up `oneshellOB = sum(children.oneshellOB)`, same for Nett/Closing
6. Overlay Tally data:
   - Index Tally rows: `Map<String, List<TallyRow>> byName` (case-insensitive, via `TreeMap<String, ?>(String.CASE_INSENSITIVE_ORDER)`)
   - Apply `TALLY_NAME_MAPPINGS` constant (`"Opening Stock" → "Stock-in-Hand"`) when indexing
   - Walk tree leaves. For each leaf, look up Tally rows by name. If multiple candidates, pick the one whose `closing` is closest to `oneshellClosing` (mirrors `find_best_api_match`)
   - Mark matched Tally rows as used
7. Filter virtual accounts:
   - Constant set: `{"Opening Stock", "Closing Stock", "Sales Bills to Make", "Purchase Bills to Come", "Unadjusted Forex Gain/Loss", "Gross Profit", "Nett Profit"}`
   - Any Tally row matching a virtual account → added to `virtualAccounts` response bucket, excluded from tree and from match/mismatch counts
   - Exception: `"Opening Stock"` is both a virtual and a mapped name — it **also** overlays onto `Stock-in-Hand` for OB comparison only (Nett/Closing comparison skipped — `nettOk=true, closingOk=true`)
8. Unmatched Tally rows → `tallyOnly` response bucket (flat list of `TbTreeNode` with no children)
9. Compute per-node status:
   - Tolerance constant: `TOLERANCE = 1.0`
   - `obOk = Math.abs(Math.abs(tallyOB) - Math.abs(oneshellOB)) < 1.0` (and likewise for Nett, Closing)
   - `MATCH` if all three ok; `MISMATCH` if any fail; `TALLY_ONLY` / `ONESHELL_ONLY` / `NO_TALLY_DATA` for one-sided rows
   - For Income/Expenses OB-exclusion case: if OnShell OB = 0 but Tally OB ≠ 0 and the leaf's parent chain contains an Income or Expenses root, populate a `note` field `"OnShell excludes opening balance for Income/Expenses accounts"`
10. Compute summary counts and return response

**Concurrency:** parse runs on `boundedElastic`; MongoDB fetches use existing reactive client; tree building is synchronous after `Mono.zip`.

#### 3. DTOs

```java
// PosDataSyncService/src/main/java/com/oneshell/model/tally/ingest/
public class TrialBalanceExcelValidationResponse {
  ParseInfo parseInfo;
  Summary summary;
  List<TbTreeNode> tree;               // root nodes
  List<TbTreeNode> virtualAccounts;    // Tally virtuals, flat
  List<TbTreeNode> tallyOnly;          // Tally rows not in OnShell COA, flat

  public static class Summary {
    int totalLeaves;
    int matched;
    int mismatched;
    int tallyOnly;
    int oneshellOnly;
    int virtualSkipped;
    int obMatchCount;
    int nettMatchCount;
    int closingMatchCount;
  }

  public static class TbTreeNode {
    String name;
    String parent;
    boolean isGroup;
    boolean isLastLevel;
    Double tallyOB, tallyNett, tallyClosing;
    Double oneshellOB, oneshellNett, oneshellClosing;
    Double obDiff, nettDiff, closingDiff;
    Boolean obOk, nettOk, closingOk;
    String status;   // MATCH | MISMATCH | TALLY_ONLY | ONESHELL_ONLY | NO_TALLY_DATA
    String note;     // nullable; OB-exclusion note etc.
    List<TbTreeNode> children;
  }
}
```

#### 4. Controller

```java
// TallyIngestController.java — new handler
@PostMapping(path = "/trial-balance/validate-excel",
             consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
public Mono<ResponseEntity<TrialBalanceExcelValidationResponse>> validateTrialBalanceExcel(
    @RequestPart("file") FilePart file,
    @RequestParam("fromDate") String fromDate,
    @RequestParam("toDate") String toDate,
    @RequestHeader("X-Business-Id") String businessId,
    @RequestHeader(value = "X-Business-City", required = false) String businessCity) {
  return DataBufferUtils.join(file.content())
      .map(dataBuffer -> {
        byte[] bytes = new byte[dataBuffer.readableByteCount()];
        dataBuffer.read(bytes);
        DataBufferUtils.release(dataBuffer);
        return bytes;
      })
      .flatMap(bytes -> service.validate(bytes, file.filename(), fromDate, toDate, businessId, businessCity))
      .map(ResponseEntity::ok);
}
```

**Spring config** — add file-size limit to `application.yaml`:
```yaml
spring:
  codec:
    max-in-memory-size: 20MB
```

### TallyConnector — new code

All changes in `TallyConnector/src/main/resources/static/index.html`.

#### 5. New dashboard section

Inserted after the existing "XML Preview" section:

```html
<section class="dashboard-section">
  <h2>Validate Trial Balance (XLS)</h2>
  <div class="tb-controls">
    <label>Financial Year
      <select id="tb-fy"></select>  <!-- populated by JS from today's date -->
    </label>
    <label>Trial Balance File
      <input type="file" id="tb-file" accept=".xlsx">
    </label>
    <button id="tb-validate-btn">Validate</button>
  </div>
  <div id="tb-status"></div>
  <div id="tb-result"></div>  <!-- max-height: 70vh; overflow-y: auto -->
</section>
```

**FY dropdown options** (computed from `new Date()`):
- Current FY (e.g., "2026-04-01 to 2027-03-31")
- Previous FY (e.g., "2025-04-01 to 2026-03-31")
- FY before that (e.g., "2024-04-01 to 2025-03-31")

FY boundaries: Apr 1 to Mar 31. If today is on or after April 1 of year Y, current FY starts Apr 1 of Y; else current FY starts Apr 1 of (Y−1).

#### 6. JS functions

- `populateFyDropdown()` — called on page load, builds three options
- `handleTbValidate()`:
  - Reads selected FY → computes `fromDate`, `toDate` in `yyyyMMdd`
  - Builds `FormData` with `file`, `fromDate`, `toDate`
  - POSTs to `${PDS_BASE}/api/v1/data/tally-ingest/trial-balance/validate-excel` with headers `X-Business-Id`, `X-Business-City` (from existing config), `Authorization: Bearer <token>` (from existing auth cache)
  - Loading state: disables button, shows spinner + "Uploading and validating..."
  - On 2xx → `renderTbResult(response)`
  - On non-2xx → parse JSON error, red banner with `error + detail`
  - On network error → generic "Failed to reach PosDataSyncService" with retry button
  - Client-side timeout: 120 seconds
- `renderTbResult(response)`:
  - Panel header: parseInfo summary ("Parsed 247 rows, detected OB+Nett+Closing layout, 7 virtual accounts excluded")
  - Summary: color-coded counts (matched/mismatched/tallyOnly/oneshellOnly)
  - FY banner: "Validated against FY 2025-04-01 → 2026-03-31"
  - Recursive tree rendering via `renderTbNode(node, depth)`:
    - `<div class="tb-row tb-indent-{depth}">`
    - Disclosure triangle if `children.length > 0`, collapsed by default for groups
    - Columns: name | Tally OB | OnShell OB | Tally Nett | OnShell Nett | Tally Closing | OnShell Closing | status pill
    - Per-field cell gets `.mismatch` class when corresponding ok flag is false
    - Click toggles children visibility
    - Tooltip on `note` field if present
  - Collapsible buckets at bottom:
    - "Tally Virtual Accounts (Excluded)" — flat list from `response.virtualAccounts`
    - "Tally Ledgers Not in OnShell" — flat list from `response.tallyOnly`, with note about Sundry Debtor/Creditor Parties
- CSS additions: `.tb-row`, `.tb-indent-1..6`, `.mismatch`, `.match`, `.tally-only`, `.oneshell-only`, `.tb-pill` pill styles reusing existing color tokens

## Data flow (happy path)

1. User picks "Previous FY" and `Sankalp-TrialBal.xlsx`, clicks Validate
2. TC computes `fromDate=20250401`, `toDate=20260331`; builds FormData
3. TC POSTs to `/api/v1/data/tally-ingest/trial-balance/validate-excel` with headers
4. PDS controller reads bytes, delegates to service
5. Service parses workbook on bounded elastic — returns 247 rows, layout OB_NETT_CLOSING
6. Service fetches COA (4,034 docs) + allTransactions (25,430 docs) in parallel via `Mono.zip`
7. Service computes per-coaId OB, debit, credit, nett, closing
8. Service builds tree: 5 root nodes (Assets, Liabilities, Income, Expenses, P&L), rolls up group totals
9. Service overlays Tally rows by name, picks closest-closing for duplicates
10. Service buckets 7 virtual accounts; maps Opening Stock OB onto Stock-in-Hand
11. Service returns response
12. TC renders tree, roots collapsed; user expands Assets → sees Current Assets → Bank Accounts → individual bank ledgers with 6 cells each, mismatches highlighted red

## Edge cases

| # | Case | Behavior |
|---|------|----------|
| E1 | Non-xlsx file (`.xls`, `.csv`, `.pdf`) | POI fails → `TrialBalanceParseException("Unable to read workbook — ensure file is .xlsx")` → 400 |
| E2 | Missing header row | `TrialBalanceParseException("Could not detect trial balance headers...")` → 400 |
| E3 | Tally "Grand Total" row | Skipped by parser; `parseInfo.grandTotalFound = true` |
| E4 | All-zero rows in Tally (OB=0, Nett=0, Closing=0) | Skipped during overlay; won't inflate MISMATCH count |
| E5 | Duplicate Tally ledger names | `Map<String, List<TallyRow>>`; pick closest-closing candidate |
| E6 | Case-difference in names | Case-insensitive `TreeMap` — matches correctly |
| E7 | Name mapping `Opening Stock → Stock-in-Hand` | Overlaid onto Stock-in-Hand leaf; OB compared, Nett/Closing `ok=true` (skipped) |
| E8 | Virtual accounts with non-zero values | Always bucketed to `virtualAccounts`, never counted in match/mismatch |
| E9 | Income/Expenses OB exclusion (Audit Fee Payable pattern) | Leaf shows MISMATCH with `note` populated — never silently hidden |
| E10 | Date range mismatch (wrong FY picked) | UI shows selected FY prominently; mismatches will be large — user's responsibility |
| E11 | Sundry Debtor/Creditor Parties | Not in COA leaves → Tally rows land in `tallyOnly` bucket with explanatory UI subtitle; no code change in v1 |
| E12 | File >20 MB | Spring returns 413 → TC shows "File too large — max 20 MB" |
| E13 | Empty COA for business | 400 with `"Business {id} has no chart of accounts — ensure Tally sync has run"` |
| E14 | MongoDbService unreachable | 500 with `"Failed to fetch OnShell data from MongoDbService"` |

## Error handling

**Parser**
- Wraps all POI exceptions in `TrialBalanceParseException`
- User-readable messages; POI internals never leak to response
- Logs file name + size + `lastRowNum` at INFO

**Service**
- `Mono.zip` failure → propagates; controller maps to 500
- Empty COA → explicit 400 (prevents obscure NPE)
- All other uncaught → `.onErrorResume` maps to 500 response with `detail`

**Controller**
- `@ExceptionHandler(TrialBalanceParseException.class)` → 400 `{error: "PARSE_FAILED", detail}`
- File size exceeded → 413 `{error: "FILE_TOO_LARGE", detail: "Maximum 20 MB"}`
- Generic exception → 500 `{error: "INTERNAL", detail}`

**UI**
- Non-2xx → parse JSON body, red banner
- Network error → generic message + retry
- Client timeout 120s

## Testing

### Unit tests (PDS)

**`TrialBalanceExcelParserTest`** (pure, no Spring)
- `parseObNettClosingLayout` — fixture `tb-ob-nett-closing.xlsx`; assert 247 rows, layout=OB_NETT_CLOSING, columns=B/D/F
- `parseNettClosingLayout` — fixture without OB column; assert layout=NETT_CLOSING
- `missingHeaderThrows` — no header labels → `TrialBalanceParseException`
- `grandTotalRowSkipped` — assert `grandTotalFound=true`, row not in `rows`
- `blankRowsSkipped` — interspersed blanks handled
- `corruptFileThrows` — random bytes → exception
- `emptySheetThrows`
- Fixtures live in `src/test/resources/fixtures/tbexcel/`. One fixture per test case; generate them with a small helper or commit real samples from QA.

**`TrialBalanceExcelValidationServiceTest`** (Mockito)
- `leafMatchOnAllThreeFields` — OnShell OB=1000, Nett=500, Closing=1500; Tally matches → MATCH
- `leafMismatchOnClosing` — Closing differs by 100 → MISMATCH, `closingOk=false`, others true
- `tallyOnlyLedger` — Tally row has no matching COA name → `tallyOnly` bucket
- `oneshellOnlyLedger` — COA leaf with non-zero balance, no Tally row → leaf with `NO_TALLY_DATA` status
- `treeRollupForGroup` — 3 leaves under "Current Assets"; group OB/Nett/Closing = sum of children
- `virtualAccountBucketed` — Tally "Gross Profit" → `virtualAccounts` bucket, not in tree, not in counts
- `openingStockMappedToStockInHand` — overlays onto Stock-in-Hand, Nett/Closing `ok=true`
- `duplicateTallyNamePicksBestMatch` — two "Bank Charges" rows, picks closest-closing
- `incomeExpenseObExclusionNote` — OnShell OB=0, Tally OB=25000 under Expenses → MISMATCH + `note` populated
- `caseInsensitiveNameMatch` — "bank of india" vs "Bank of India" → matches
- `toleranceBoundary` — diff=0.99 MATCH, diff=1.01 MISMATCH
- `emptyCoaReturnsError` — empty COA → error response

**`TallyIngestControllerTest`** (`@WebFluxTest`)
- `validateExcelEndpoint_happyPath` — MultipartBodyBuilder with fixture xlsx → 200 + tree present
- `validateExcelEndpoint_missingFile` → 400
- `validateExcelEndpoint_parseError` — garbage bytes → 400 `PARSE_FAILED`
- `validateExcelEndpoint_missingBusinessIdHeader` → 400

### Manual test plan (TC UI)

Run after PDS deploys:
1. Build TC: `cd TallyConnector && ./mvnw clean package -DskipTests`
2. Start TC, open dashboard in browser
3. Select "Previous FY", pick `Sankalp-TrialBal.xlsx`, click Validate
4. Expect: tree renders, root nodes collapsed, parseInfo + summary shown at top
5. Expand Assets → see children, per-field cells rendered, mismatches highlighted red
6. Scroll to bottom → open Virtual Accounts bucket → Opening Stock, Gross Profit, Nett Profit visible
7. Open "Tally Ledgers Not in OnShell" bucket → any unmatched entries visible with subtitle about Sundry Debtor/Creditor Parties
8. Upload a random `.pdf` → red error banner "Unable to read workbook..."
9. Upload wrong-FY file → see selected FY in banner, mismatches are obvious
10. Cross-check counts against `python3 compare-tb-full.py ...` on the same file — counts should agree within tolerance

### Integration

- Run on all 4 QA test businesses (Sankalp, Meco, Spandana, YCRJ) after reset + pull sync
- Compare TC UI numbers to `compare-tb-full.py` output side-by-side

### Out of scope for v1

- Automated TC frontend tests (no existing harness in `index.html`)
- Load testing beyond 10k rows
- Mocking POI (trust the dependency)

## Deployment

**PDS version bump**: 1.1.82 → 1.1.83. Follow existing procedure (pom.xml, commit, tag, push). Auto-deploys to QA via Tekton on master push.

**TC version bump**: 1.1.57 → 1.1.58. Follow existing procedure (`pom.xml` + `launch4j-config.xml` 4 occurrences). Rebuild jar for distribution.

**No database migrations.** **No config changes** besides the `spring.codec.max-in-memory-size` setting in PDS `application.yaml`.

## Rollout

1. Merge PDS changes to master → auto-deploy to QA
2. Manual smoke test PDS endpoint via curl with a known XLSX fixture
3. Merge TC changes to master → rebuild jar, distribute to QA tester
4. Run manual test plan on all 4 businesses
5. Fix any issues, iterate
6. Production release: tag `posdatasyncservice v1.1.83`, distribute new TC jar

## Open questions

None. All design decisions answered during brainstorming on 2026-04-11.

## References

- `PosDataSyncService/src/main/java/com/oneshell/controller/tally/TallyIngestController.java` — existing `/trial-balance/validate` handler
- `PosDataSyncService/src/main/java/com/oneshell/service/tally/TrialBalanceValidationService.java` — existing balance computation logic (pattern reference only; not modified)
- `PosDataSyncService/src/main/java/com/oneshell/model/tally/ingest/TrialBalanceValidationRequest.java` / `TrialBalanceValidationResponse.java` — existing DTOs (not modified)
- `TallyConnector/scripts/compare-tb-full.py` — canonical parsing and matching algorithm being ported to Java
- `TallyConnector/src/main/resources/static/index.html` — TC dashboard (~1,381 lines)
- CLAUDE.md memory `tally-architecture.md` §5, §6 — trial balance pipelines and Income/Expenses OB exclusion rule
- CLAUDE.md memory `tally-testing-sop.md` Part 4 — Tally Excel format details
