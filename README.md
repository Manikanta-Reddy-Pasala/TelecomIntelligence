# TIAC - Telecom Intelligence Analyst Copilot

An AI-powered investigation platform for telecom CDR (Call Detail Record) analysis. TIAC enables intelligence analysts to investigate phone numbers, detect anomalies, trace movement patterns, and uncover communication networks through a conversational AI copilot interface.

---

## Table of Contents

- [What It Does (Non-Technical)](#what-it-does-non-technical)
- [Feature List](#feature-list)
- [Technical Architecture](#technical-architecture)
- [Investigation Tools](#investigation-tools)
- [AI Copilot - Deep Dive](#ai-copilot---deep-dive)
- [LLM Training Guide](#llm-training-guide)
- [Complete API Reference](#complete-api-reference)
- [Frontend Pages](#frontend-pages)
- [Quick Start](#quick-start)
- [Deployment](#deployment)
- [Security and Compliance](#security-and-compliance)
- [Tech Stack Details](#tech-stack-details)
- [License](#license)

---

## What It Does (Non-Technical)

TIAC is a tool built for telecom intelligence analysts who need to investigate phone activity. Instead of writing database queries manually, analysts can **ask questions in plain English** and get instant answers backed by data.

### Key Capabilities

- **Ask Questions Naturally**: "Give all info about +919656152900" instantly returns the person's profile, call history, movement trail, contacts, and anomaly alerts
- **Movement Tracking**: See where a phone traveled on a map - from tower to tower, with timestamps and dwell times at each location
- **Contact Conversations**: View all conversations with each contact -- messages and call transcripts in an expandable conversation view
- **Anomaly Detection**: Automatically flags suspicious behavior - impossible travel (appearing at distant locations within minutes), sudden contact bursts, SIM swaps, unusual call times
- **16 Investigation Tools**: 10 one-click tools on the Tools panel plus 6 additional tools accessible via chat (search messages, search calls, tower dump, co-location, common contacts, call chain)
- **Timeline View**: Chronological view of all calls, messages, and location events grouped by date with sticky headers and type filters
- **Case Management**: Create investigation cases, link entities (phones, persons, devices), and save insights as you investigate
- **Date Range Filtering**: Focus your investigation on a specific time period
- **Full-Text Search**: Search across both message content and call transcripts simultaneously
- **Full Audit Trail**: Every query, every data access is logged for compliance

### Who Is It For

- **Analysts**: Primary investigators who query the system and build cases
- **Supervisors**: Review findings and approve escalations
- **Auditors**: Monitor system usage and ensure compliance
- **Admins**: Manage users and system configuration

---

## Feature List

### Core Intelligence
- Natural language copilot with parallel data fetching and LLM summarization
- Keyword-based intent classification (comprehensive, relationship, location, timeline, content, pattern)
- Regex-based MSISDN extraction (no LLM dependency for parameter parsing)
- Structured fallback when LLM is unavailable or slow

### Entity Management
- Person directory with search, watchlist filtering, risk scores
- Phone number profiles with CDR summary statistics
- Device tracking by IMEI
- SIM card inventory with status tracking
- Unified cross-entity search

### Communication Analysis
- Call detail record browsing with multi-dimensional filters
- Call transcripts on CDR records (25 realistic conversation templates)
- SMS/MMS message records with content previews
- Contact conversations view with expandable message and transcript history
- Common contacts between two MSISDNs
- Shortest-path (BFS) between any two numbers
- Top contacts ranked by interaction volume with 7x24 heatmap
- Full-text search across message content and call transcripts

### Location Intelligence
- Tower inventory with geo-coordinate filtering
- Movement trail visualization on interactive map
- Dwell time analysis per tower
- Location heatmap (tower coordinates weighted by event count)
- Tower activity lookup (all MSISDNs at a tower in a time range)
- Co-location detection (two MSISDNs at same tower within time window)
- Geofence analysis (bounding box area surveillance)
- Tower dump analysis (all devices on a specific tower)

### Investigation Tools (16 total)

**One-click tools panel (10):**
- Tower Dump, Geofence, Pattern of Life, IMEI/SIM Change Detection
- Common Number Analysis, Call Chain, Night Activity, Top Contacts with Heatmap
- Comprehensive Report Generation, Activity Summary Stats

**Chat-accessible tools (6):**
- Search Messages, Search Calls, Tower Dump, Co-location, Common Contacts, Call Chain

All tools execute directly on click -- no modals or popups.

### Anomaly Detection
- Impossible travel detection (Haversine distance / time, >300 km/h threshold)
- Contact burst detection (new contacts vs historical baseline)
- Volume spike detection (daily count vs 90-day mean + 2 standard deviations)
- Unusual call time flagging (midnight to 5 AM)
- Co-location pattern detection

### Case Management
- Create/update/close investigation cases
- Link entities (phones, persons, devices) to cases
- Investigation notebook with insights and evidence references
- Status and priority tracking

### Security
- JWT authentication with configurable expiry
- Role-based access control (analyst, supervisor, admin, auditor)
- Full audit logging of every query and data access
- Air-gap compatible (LLM runs locally via Ollama)

---

## Technical Architecture

### Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18, Vite, Tailwind CSS | Modern SPA with dark theme |
| **Backend** | Python 3.12, FastAPI, SQLAlchemy (async) | REST API with async PostgreSQL |
| **Database** | PostgreSQL 16 | Relational storage for all entities and events |
| **AI/LLM** | Ollama (`tiac-analyst`, built from phi3:mini) | Natural language response generation |
| **Visualization** | Leaflet (maps), Recharts (charts) | Interactive data visualization |
| **Deployment** | Docker Compose (4 containers) | Single-command deployment |

### System Architecture

```
                    +------------------+
                    |   React Frontend |
                    |   (Port 3000)    |
                    +--------+---------+
                             |
                    +--------v---------+
                    |  Nginx (Reverse  |
                    |  Proxy /api/)    |
                    +--------+---------+
                             |
                    +--------v---------+
                    |  FastAPI Backend  |
                    |   (Port 8000)    |
                    +---+----+----+----+
                        |    |    |
              +---------+    |    +---------+
              |              |              |
     +--------v---+  +------v------+  +----v--------+
     | PostgreSQL  |  |   Ollama    |  |   Audit     |
     | (Port 5432) |  | (Port 11434)|  |   Logger    |
     +-------------+  +------+------+  +-------------+
                             |
                      +------v------+
                      | tiac-analyst|
                      | (phi3:mini  |
                      |  base)      |
                      +-------------+
```

Only one Ollama model is used: `tiac-analyst`. It is built from the `phi3:mini` base model using a Modelfile with a custom system prompt and few-shot examples. The base `phi3:mini` model is removed after building to save disk space.

### Data Model

```
persons --- phone_numbers --- sims
   |              |
   +-- devices    +-- call_records (CDR, with transcript field)
                  +-- messages (SMS/MMS)
                  +-- location_events (tower pings)
                  +-- data_sessions

cases --- case_entities --- case_insights

users --- audit_logs
          anomaly_alerts
```

### Core Entities

| Entity | Description | Volume (Seed) |
|--------|------------|---------------|
| Persons | Individuals under investigation | 50 |
| Phone Numbers | MSISDNs linked to persons | 80 |
| Devices | Phones/tablets with IMEIs | 60 |
| SIMs | SIM cards with IMSI/ICCID | 100 |
| Towers | Cell towers with geo-coordinates (Mumbai) | 194 |
| Call Records | CDR data with transcripts (caller, callee, duration, tower, transcript) | 25,000+ |
| Messages | SMS/MMS with content previews | 12,000+ |
| Location Events | Tower pings with signal strength | 31,000+ |
| Data Sessions | Mobile data usage records | 8,000 |
| Anomaly Alerts | Detected suspicious patterns | 10 |
| Cases | Investigation cases | 5 |

---

## Investigation Tools

TIAC provides 16 investigation tools in total. 10 are available as one-click tools on the **Tools** tab (click a tool and it runs immediately -- no modals or popups). An additional 6 tools are accessible via the chat interface.

### One-Click Tools Panel (10)

### 1. Tower Dump Analysis

Identifies every MSISDN that connected to a specific cell tower during a given time window. Essential for crime scene analysis -- "who was near this location at this time?"

- **API endpoint**: `GET /api/advanced/tower-dump/{tower_id}?from=...&to=...&limit=500`
- **Example query**: `GET /api/advanced/tower-dump/MUM-COL-000-01?from=2026-01-15T00:00:00&to=2026-01-15T23:59:59`
- **Algorithm**: Queries `location_events` table joined to `towers`, groups by MSISDN. For each MSISDN computes event count, first/last seen timestamps, dwell time (difference between first and last seen in minutes), average signal strength, and distinct event types.
- **Output**: Tower metadata (ID, lat/lng, city), total unique MSISDNs, and per-MSISDN breakdown: `{msisdn, event_count, first_seen, last_seen, dwell_minutes, event_types, avg_signal_strength}`

### 2. Geofence Analysis

Finds all MSISDNs that appeared within a geographic bounding box. Used for area surveillance -- "who was in this neighborhood last week?"

- **API endpoint**: `POST /api/advanced/geofence`
- **Request body**: `{lat_min, lat_max, lng_min, lng_max, date_from?, date_to?}`
- **Example**: `{"lat_min": 18.90, "lat_max": 18.95, "lng_min": 72.80, "lng_max": 72.85, "date_from": "2026-01-01T00:00:00"}`
- **Algorithm**: Joins `location_events` with `towers`, filters towers whose coordinates fall within the bounding box. Groups by MSISDN and returns event counts, first/last seen, and list of towers used within the area.
- **Output**: Bounds definition, total unique MSISDNs, per-MSISDN: `{msisdn, event_count, first_seen, last_seen, towers_used[]}`

### 3. Pattern of Life

Builds a behavioral profile for an MSISDN by analyzing location data over a configurable period (default 30 days). Answers "where does this person sleep, work, and spend weekends?"

- **API endpoint**: `GET /api/advanced/pattern-of-life/{msisdn}?days=30`
- **Example query**: `GET /api/advanced/pattern-of-life/+919656152900?days=60`
- **Algorithm**:
  - **Sleep location**: Most frequent tower between 11 PM and 6 AM, with confidence = (events at tower / total night events)
  - **Work location**: Most frequent tower between 9 AM and 6 PM on weekdays (Mon-Fri), with confidence score
  - **Weekend location**: Most frequent tower on Saturdays and Sundays
  - **Hourly activity**: 24-slot histogram of location events per hour
  - **Weekly activity**: 7-slot histogram (Mon through Sun)
  - **Regular routes**: Top 5 most frequent tower-to-tower transitions with typical time of day (average hour:minute of all occurrences)
  - **Routine score**: Entropy-based predictability metric. Lower entropy (more concentrated activity pattern) yields a higher routine score (0.0 to 1.0). Calculated as `1 - (entropy / max_entropy)` where max_entropy is `log(24)` (uniform distribution across all hours).
- **Output**: `{sleep_location, work_location, weekend_location, hourly_activity[24], weekly_activity[7], regular_routes[5], routine_score}`

### 4. IMEI/SIM Change Detection

Checks whether an MSISDN has been associated with different devices or SIM cards. Detects SIM swaps, device changes, and suspicious identity patterns.

- **API endpoint**: `GET /api/advanced/identity-changes/{msisdn}`
- **Example query**: `GET /api/advanced/identity-changes/+919378304807`
- **Algorithm**: Traverses the `PhoneNumber -> SIM -> Device` chain:
  - Counts SIM cards linked to the phone number (multiple SIMs = risk factor)
  - Finds devices linked via SIM cards (multiple devices via SIMs = risk factor)
  - Finds devices linked via the person record (multiple personal devices = risk factor)
  - Checks SIM statuses (suspended/inactive = risk factor)
  - Risk assessment: 3+ risk factors = HIGH, 1-2 = MEDIUM, 0 = LOW
- **Output**: `{msisdn, person_id, identity_changes[{type, count, sims/devices}], risk_assessment: HIGH|MEDIUM|LOW}`

### 5. Common Number Analysis

Given a list of MSISDNs, finds phone numbers that all (or any two) of them have communicated with. Used for network overlap detection -- "do these suspects share contacts?"

- **API endpoint**: `POST /api/advanced/common-numbers?from=...&to=...`
- **Request body**: `{"msisdns": ["+919656152900", "+919590122159", "+919739362057"]}`
- **Algorithm**: For each input MSISDN, fetches the complete contact set (calls + messages, both directions). Computes set intersection across all inputs for "common to all", and pairwise intersections for "common to any two". Input MSISDNs are excluded from results.
- **Output**: `{input_msisdns, common_to_all[{msisdn, interaction_count_per_input[]}], common_to_all_count, common_to_any_two[{msisdn, shared_with[]}], common_to_any_two_count}`

### 6. Call Chain Analysis

Finds the shortest communication chain between two MSISDNs with per-hop details. Enhanced version of shortest-path with call count, duration, and last contact time for each link.

- **API endpoint**: `GET /api/advanced/call-chain?source=...&target=...&max_hops=4`
- **Example query**: `GET /api/advanced/call-chain?source=+919656152900&target=+919845122940&max_hops=4`
- **Algorithm**: BFS shortest-path traversal through the contact graph (up to `max_hops`, max 6). Each hop is then enriched with: call count (both directions), total call duration, last call timestamp, and message count between the pair. Date filters can narrow the enrichment window.
- **Output**: `{source, target, found, path[], hops, hop_details[{from, to, call_count, total_duration_seconds, last_call_time, message_count}]}`

### 7. Night Activity Detection

Extracts all calls and messages made during configurable night hours. Flags covert communication patterns.

- **API endpoint**: `GET /api/advanced/night-activity/{msisdn}?night_start=23&night_end=5&from=...&to=...`
- **Example query**: `GET /api/advanced/night-activity/+919845122940?night_start=23&night_end=5`
- **Algorithm**: Filters call records and messages where `extract(hour, timestamp)` falls within the night window. Handles wrap-around (e.g., 23:00 to 05:00) with OR logic. Returns full detail for each night event including direction, other party, timestamp, and duration/status.
- **Output**: `{msisdn, night_hours, total_night_calls, total_night_messages, unique_night_contacts, night_calls[], night_messages[]}`

### 8. Top Contacts with Heatmap

Returns the most frequently contacted numbers ranked by total interactions, each with a 7x24 communication heatmap (day-of-week by hour-of-day).

- **API endpoint**: `GET /api/advanced/top-contacts/{msisdn}?limit=20&from=...&to=...`
- **Example query**: `GET /api/advanced/top-contacts/+919656152900?limit=10`
- **Algorithm**: Aggregates all calls and messages (both directions) per contact. Sorts by total interactions, takes top N. For each contact, builds a 7x24 matrix (Mon=row 0, Sun=row 6; hours 0-23) by counting calls and messages in each (day, hour) bucket. PostgreSQL day-of-week is remapped from Sunday=0 to Monday=0 indexing.
- **Output**: `{msisdn, total_contacts_analyzed, top_n, contacts[{msisdn, call_count, message_count, total_duration_seconds, total_interactions, heatmap[7][24]}]}`

### 9. Report Generation (Comprehensive Dossier)

Generates a complete JSON dossier for an MSISDN by composing results from multiple investigation tools into a single response. Configurable sections.

- **API endpoint**: `POST /api/advanced/report/{msisdn}`
- **Request body**: `{"days": 30, "include_top_contacts": true, "include_pattern_of_life": true, "include_identity_changes": true, "include_night_activity": true, "include_stats": true}`
- **Algorithm**: Sequentially calls entity lookup, CDR summary (in/out calls and messages with durations), top contacts, pattern of life, identity changes, night activity count, and activity stats. All sections are optional via boolean flags.
- **Output**: `{msisdn, generated_at, generated_by, entity{person, status, carrier}, cdr_summary, top_contacts[], pattern_of_life, identity_changes, night_activity_summary, stats}`

### 10. Activity Summary Stats

Quick-reference statistics for an MSISDN over a configurable period.

- **API endpoint**: `GET /api/advanced/stats/{msisdn}?days=30`
- **Example query**: `GET /api/advanced/stats/+919656152900?days=90`
- **Algorithm**: Runs individual count queries for outgoing/incoming calls and messages. Counts unique contacts using CASE expression. Counts active days (distinct dates with any activity). Computes average daily calls. Finds most active hour and most active day of week.
- **Output**: `{msisdn, period_days, outgoing_calls, incoming_calls, total_calls, outgoing_messages, incoming_messages, total_messages, unique_contacts, active_days, avg_daily_calls, most_active_hour, most_active_hour_label, most_active_day}`

### Chat-Accessible Tools (6)

These tools are invoked by typing natural language queries into the copilot chat:

| Tool | Example Query |
|------|--------------|
| **Search Messages** | "Search messages for keyword bomb" |
| **Search Calls** | "Search calls to +919656152900" |
| **Tower Dump** | "Tower dump for MUM-COL-000-01" |
| **Co-location** | "Co-location check +919620332086 and +919866162966" |
| **Common Contacts** | "Find common contacts between +919656152900 and +919590122159" |
| **Call Chain** | "Call chain from +919656152900 to +919845122940" |

---

## AI Copilot - Deep Dive

The copilot is the core intelligence layer. It processes natural language queries, fetches data from PostgreSQL in parallel, and uses a locally-hosted LLM to generate analyst-grade summaries.

### Query Processing Pipeline

```
  User Message
       |
       v
  +--------------------+
  | 1. MSISDN Extract  |  Regex: \+?\d{10,15}
  |    (instant)       |  Also extracts person names via capitalization heuristic
  +--------------------+
       |
       v
  +--------------------+
  | 2. Intent Classify |  Keyword matching against 6 intent categories
  |    (instant)       |  Default: "comprehensive" (show everything)
  +--------------------+
       |
       v
  +--------------------+
  | 3. Data Fetching   |  Parallel async queries to PostgreSQL (~100ms)
  |    (PostgreSQL)    |  Entity + CDR + Messages + Locations + Contacts + Anomalies
  +--------------------+
       |
       v
  +--------------------+
  | 4. LLM Summary     |  Ollama generate API with structured prompt (~3s)
  |  (tiac-analyst)    |  10s timeout, structured fallback on failure
  +--------------------+
       |
       v
  +--------------------+
  | 5. Response Build  |  Populates all frontend tabs in one response
  |    (assembly)      |  + follow-up suggestions
  +--------------------+
```

### Step 1: Parameter Extraction (Regex)

MSISDNs are extracted via regex `\+?\d{10,15}` directly from the user message. No LLM is involved in parameter extraction, making it reliable and fast. If two MSISDNs are found, the first is the primary target and the second is used for relationship/co-location queries.

Person names are extracted via a heuristic: capitalized words following "person", "name", or "about" (e.g., "about Amit Sharma" extracts "Amit Sharma").

IMEIs are also matched via `\b\d{15}\b`.

### Step 2: Intent Classification (Keyword Rules)

The query is classified into one of 6 intents using keyword matching (case-insensitive):

| Intent | Trigger Keywords | What Gets Fetched |
|--------|-----------------|-------------------|
| `comprehensive` | "all info", "everything", "full", "details", "summary", "investigate" | All data categories |
| `relationship` | "contact", "network", "called", "communicated", "common", "who called" | Entity + Contacts |
| `location` | "location", "tower", "movement", "trail", "where", "traveled" | Entity + Location trail + Map |
| `timeline` | "timeline", "history", "chronolog", "when", "activity", "events" | Entity + CDR + Messages + Timeline |
| `content` | "message", "sms", "text", "content", "conversation" | Entity + Messages |
| `pattern` | "anomal", "unusual", "pattern", "spike", "burst", "suspicious" | Entity + Anomalies |

If no keywords match, defaults to `comprehensive`.

### Step 3: Data Fetching

Based on the classified intent, the system fetches data in parallel from PostgreSQL:

- **Entity Profile**: Person name, carrier, status, nationality, risk score, watchlist flag, linked phones, linked devices, total call/message counts
- **Call Records**: Last 50 CDRs with transcripts (with optional date range filter), transformed into timeline entries with direction, other party, duration
- **Messages**: Last 30 SMS/MMS records, added to timeline
- **Location Trail**: All location events via `GeoAnalyticsService.get_movement_trail()`, capped at 200 points for the map
- **Contact Network**: Via `GraphAnalyticsService.get_contact_network()`, top 20 contacts with interaction counts
- **Anomalies**: Stored anomaly alerts from DB + real-time impossible travel detection via `AnomalyDetectionService.detect_impossible_travel()`
- **Co-location**: If two MSISDNs are provided, checks for co-location events within a 30-minute window

### Step 4: LLM Response Generation

The fetched data summary is formatted into a structured prompt matching the custom model's training format:

```
Query: {user's original message}
Facts: {summary of all findings, joined by periods}
Response:
```

This prompt is sent to Ollama's `/api/generate` endpoint (model: `tiac-analyst`) with a 10-second timeout. If the LLM:
- Returns a valid response (>30 chars, no "unavailable" text): used as-is
- Times out after 10 seconds: falls back to structured bullet-point summary
- Fails for any other reason: falls back to structured summary

The structured fallback format is: `**Findings:**\n- bullet point per data category`

### Step 5: Response Structure

The copilot returns a single JSON response that populates all frontend tabs:

```json
{
  "response": "LLM-generated or fallback analyst summary",
  "confidence": 0.9,
  "evidence": [
    {"source": "Entity Profile", "data": {...}, "relevance": 1.0},
    {"source": "Call Detail Records", "data": {...}, "relevance": 0.9},
    {"source": "Messages", "data": {...}, "relevance": 0.85},
    {"source": "Location Trail", "data": {...}, "relevance": 0.85},
    {"source": "Contact Network", "data": {...}, "relevance": 0.85},
    {"source": "Anomaly Detection", "data": {...}, "relevance": 0.95}
  ],
  "query_plan": {"intent": "comprehensive", "parameters": {"msisdn": "..."}, "description": "..."},
  "timeline": [{"type": "call|sms", "timestamp": "...", ...}],
  "locations": [{"latitude": ..., "longitude": ..., "timestamp": "...", ...}],
  "contacts": [{"msisdn": "...", "name": "...", "call_count": N, "message_count": N, "messages": [...], "transcripts": [...]}],
  "entity": {"name": "...", "carrier": "...", "risk_score": 0.85, ...},
  "suggestions": ["Show contact network for ...", "Check anomalies for ...", ...]
}
```

### How Frontend Tabs Get Populated

| Tab | Data Source | Visualization |
|-----|-----------|---------------|
| **Pattern of Life** | Pattern of life API | Sleep/work/weekend locations, hourly/weekly histograms, routine score |
| **Tools** | One-click tool execution | 10 investigation tools that execute directly on click |
| **Timeline** | `timeline[]` array | Events grouped by date with sticky headers, type filters (calls, SMS, locations), proper date formatting |
| **Map** | `locations[]` array | Leaflet map with numbered movement stops (A -> 1 -> 2 -> ... -> Z), dwell times, gradient trail, journey log sidebar |
| **Contacts** | `contacts[]` array | Expandable conversations per contact showing messages and call transcripts |
| **[Target Name]** | `entity` object | Person profile with linked phones, devices, risk score, metadata (tab shows the target's actual name, e.g., "Rohit Singh") |

### Anomaly Detection Algorithms

| Algorithm | Description | Threshold |
|-----------|-------------|-----------|
| **Impossible Travel** | Haversine distance / time between consecutive tower pings | Speed > 300 km/h |
| **Contact Burst** | New unique contacts in 7-day window vs historical baseline | 10+ new contacts |
| **Volume Spike** | Daily call count vs 90-day baseline | > mean + 2*stddev |
| **Unusual Call Time** | Calls between midnight and 5 AM | Any activity in window |
| **Co-location** | Two MSISDNs at same tower within configurable time window | Configurable (default 30 min) |

---

## LLM Training Guide

TIAC uses a single custom Ollama model (`tiac-analyst`) fine-tuned for concise telecom intelligence analysis. There are two approaches: Modelfile-based (few-shot, no GPU required) and Unsloth QLoRA (true fine-tuning, requires GPU).

### Approach 1: Ollama Modelfile (Few-Shot, CPU)

The production model is built from `phi3:mini` with a comprehensive system prompt containing few-shot examples. This is the recommended approach for most deployments.

**File**: `backend/ollama/Modelfile`

#### Base Model

```
FROM phi3:mini
```

The `phi3:mini` model (3.8B parameters) provides the best balance of response quality, speed, and memory footprint. After building the `tiac-analyst` model, the base `phi3:mini` is removed to save disk space -- only `tiac-analyst` remains in the Ollama model store.

#### System Prompt Engineering

The system prompt defines TIAC's persona and output format:

```
You are TIAC, a senior telecom intelligence analyst. You analyze CDR, location, and communication data.

RULES:
- Write 2-4 sentences maximum
- Be direct, cite specific numbers from the Facts
- Flag suspicious items as LOW/MEDIUM/HIGH/CRITICAL
- Use format: SUMMARY line, then KEY FINDINGS bullets, then RISK LEVEL
```

Five few-shot examples are embedded directly in the system prompt, covering:
1. Standard MSISDN analysis (moderate activity + anomalies)
2. Anomaly deep-dive (impossible travel + counter-surveillance)
3. Contact burst detection (200x above baseline)
4. Co-location analysis (847 events, statistically significant)
5. Organized network analysis (5-number group, nighttime operations)

#### Model Parameters Explained

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `temperature` | 0.2 | Low randomness for factual, consistent responses. Higher values (0.7+) would introduce hallucinations. |
| `top_p` | 0.8 | Nucleus sampling cutoff. Combined with low temperature, ensures responses stick to likely tokens. |
| `top_k` | 20 | Only consider top 20 most likely tokens at each step. Prevents rare/irrelevant token selection. |
| `num_predict` | 250 | Maximum output tokens. Keeps responses concise (2-4 sentences). Prevents runaway generation. |
| `repeat_penalty` | 1.3 | Penalizes token repetition. Prevents the model from repeating phrases or getting stuck in loops. |
| `stop` | `</s>`, `User:`, `Query:`, `Facts:` | Stop sequences. Prevents the model from generating follow-up prompts or continuing past its response. |

#### Prompt Template

```
TEMPLATE """{{ .Prompt }}"""
```

The raw prompt is passed directly (no chat template wrapper), because the backend constructs the exact prompt format:
```
Query: {user question}
Facts: {structured data summary}
Response:
```

#### Building the Model

```bash
# Run the training script (works with local ollama or Docker container)
cd backend/ollama
./train.sh

# Or manually:
ollama create tiac-analyst -f Modelfile

# Remove the base model to save space (tiac-analyst is self-contained)
ollama rm phi3:mini
```

The `train.sh` script auto-detects whether Ollama is running locally or in a Docker container (`tiac_ollama`) and builds accordingly.

#### Testing the Model

```bash
ollama run tiac-analyst "Query: Analyze +919876543210
Facts: 45 calls, 3 anomalies detected
Response:"
```

### Approach 2: Unsloth + QLoRA Fine-Tuning (GPU)

For production deployments where higher response quality is needed, true fine-tuning with QLoRA produces a specialized model.

**File**: `backend/ollama/training/finetune.py`

#### Prerequisites

- GPU with 8GB+ VRAM
- CUDA 11.8+

```bash
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
pip install --no-deps trl peft accelerate bitsandbytes
```

#### Training Configuration

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Base model | `unsloth/tinyllama-chat-bnb-4bit` | 4-bit quantized TinyLlama for memory efficiency |
| Max sequence length | 2048 | Sufficient for prompt + response |
| LoRA rank (r) | 16 | Number of low-rank adaptation matrices |
| LoRA alpha | 16 | Scaling factor (alpha/r = 1.0) |
| LoRA dropout | 0.0 | No dropout (small dataset) |
| Target modules | q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj | All attention + FFN projections |
| Batch size | 2 | Per-device training batch |
| Gradient accumulation | 4 | Effective batch size = 8 |
| Learning rate | 2e-4 | Standard QLoRA learning rate |
| Max steps | 60 | Small dataset, few steps needed |
| Optimizer | adamw_8bit | Memory-efficient optimizer |
| Precision | FP16 | Half-precision training |

#### Running Fine-Tuning

```bash
cd backend/ollama/training
python finetune.py
```

This produces a GGUF model file at `backend/ollama/training/output/tiac-analyst.gguf` (Q4_K_M quantization).

#### Deploying the Fine-Tuned Model

```bash
# Copy GGUF to Ollama server
# Create Modelfile.finetuned:
#   FROM /path/to/tiac-analyst.gguf
ollama create tiac-analyst-ft -f Modelfile.finetuned
```

### Training Dataset Format

**File**: `backend/ollama/training/dataset.jsonl`

The dataset is in JSONL (JSON Lines) format with 21 training examples. Each line is a JSON object:

```json
{
  "prompt": "Query: Analyze +919876543210\nFacts: Belongs to Amit Sharma (Airtel), active. 45 calls, 22 messages. 34 contacts. 2 anomalies.",
  "response": "SUMMARY: Amit Sharma (+919876543210) has moderate activity...\n\nKEY FINDINGS:\n- 34 unique contacts...\n- 2 anomalies detected...\n\nRISK LEVEL: MEDIUM..."
}
```

The prompt always follows the format `Query: ...\nFacts: ...\n`. The response always follows: `SUMMARY: ...\nKEY FINDINGS:\n- ...\nRISK LEVEL: ...`.

#### Training Examples Cover

| # | Scenario | Risk Level |
|---|----------|-----------|
| 1 | Standard subscriber analysis | MEDIUM |
| 2 | Who called / incoming call analysis | LOW |
| 3 | Movement trail analysis | LOW |
| 4 | Anomaly deep-dive (impossible travel + counter-surveillance) | CRITICAL |
| 5 | Common contacts / organized network | HIGH |
| 6 | Contact burst (200x baseline) | CRITICAL |
| 7 | Co-location (847 events) | MEDIUM |
| 8 | Date-specific activity analysis | MEDIUM |
| 9 | SIM swap detection | HIGH |
| 10 | Tower camping anomaly | HIGH |
| 11 | Encrypted communications shift | HIGH |
| 12 | Organized network summary | CRITICAL |
| 13-21 | Additional scenarios (night activity, pattern of life, call chain, etc.) | Varies |

#### Adding New Training Examples

1. Add a new JSON line to `backend/ollama/training/dataset.jsonl`:
   ```json
   {"prompt": "Query: {new query type}\nFacts: {relevant facts}", "response": "SUMMARY: ...\nKEY FINDINGS:\n- ...\nRISK LEVEL: ..."}
   ```
2. Ensure the response follows the SUMMARY / KEY FINDINGS / RISK LEVEL format
3. For Modelfile approach: add corresponding few-shot example to the system prompt in `backend/ollama/Modelfile`
4. For QLoRA approach: re-run `python finetune.py`
5. Rebuild the Ollama model: `ollama create tiac-analyst -f Modelfile`

### Benchmarks: tinyllama vs phi3:mini

| Metric | tinyllama (1.1B) | phi3:mini (3.8B) |
|--------|-----------------|------------------|
| Response latency | ~1-2s | ~2-4s |
| Memory usage | ~800MB | ~2.5GB |
| Format adherence | Often breaks SUMMARY/KEY FINDINGS format | Consistently follows format |
| Fact citation | Frequently misses numbers from Facts | Reliably cites specific numbers |
| Risk assessment | Sometimes omits or misclassifies | Accurate severity classification |
| Hallucination rate | Higher (invents details not in Facts) | Lower (stays grounded in provided Facts) |

**Recommendation**: Use `phi3:mini` (via `tiac-analyst`) for production. Use `tinyllama` only for resource-constrained environments where speed matters more than quality.

---

## Complete API Reference

TIAC exposes 50+ API endpoints across 8 categories.

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/auth/login` | JWT login with JSON body `{username, password}` | No |
| `POST` | `/api/auth/login/form` | JWT login with OAuth2 form data (for Swagger UI) | No |
| `GET` | `/api/auth/me` | Current user profile | Yes |
| `POST` | `/api/auth/users` | Create new user | Admin only |

### AI Copilot

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/copilot/chat` | Main copilot endpoint. Body: `{message, case_id?, conversation_history[], date_from?, date_to?}` | Yes |
| `GET` | `/api/copilot/suggestions/{case_id}` | Get suggested next queries for a case | Yes |

### Analytics

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/analytics/dashboard-stats` | Dashboard overview: persons, active cases, calls today, alerts, phones, towers | Yes |
| `GET` | `/api/analytics/contacts/{msisdn}` | Contact network with interaction counts | Yes |
| `GET` | `/api/analytics/common-contacts?msisdn1=...&msisdn2=...` | Shared contacts between two numbers | Yes |
| `GET` | `/api/analytics/shortest-path?source=...&target=...&max_hops=4` | BFS shortest path between MSISDNs | Yes |
| `GET` | `/api/analytics/colocation?msisdn1=...&msisdn2=...&window_minutes=30` | Co-location detection | Yes |
| `GET` | `/api/analytics/movement/{msisdn}` | Movement trail (sequence of towers with timestamps) | Yes |
| `GET` | `/api/analytics/dwell-times/{msisdn}` | Dwell time per tower | Yes |
| `GET` | `/api/analytics/heatmap/{msisdn}` | Location heatmap (tower coordinates weighted by event count) | Yes |
| `GET` | `/api/analytics/tower-activity/{tower_id}` | All MSISDNs seen at a tower (by DB integer ID) | Yes |
| `GET` | `/api/analytics/anomalies` | All unresolved anomaly alerts (optional `?msisdn=` filter) | Yes |
| `GET` | `/api/analytics/anomalies/{msisdn}` | Anomalies for a specific MSISDN | Yes |

### Advanced Investigation Tools

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/advanced/tower-dump/{tower_id}?from=...&to=...&limit=500` | Tower dump: all MSISDNs at a tower in time range (tower_id is string like MUM-COL-000-01) | Yes |
| `POST` | `/api/advanced/geofence` | Geofence: MSISDNs within geographic bounding box | Yes |
| `GET` | `/api/advanced/pattern-of-life/{msisdn}?days=30` | Pattern of life: sleep/work/weekend locations, hourly/weekly histograms, routes, routine score | Yes |
| `GET` | `/api/advanced/identity-changes/{msisdn}` | IMEI/SIM change detection with risk assessment | Yes |
| `POST` | `/api/advanced/common-numbers?from=...&to=...` | Common number analysis across multiple MSISDNs | Yes |
| `GET` | `/api/advanced/call-chain?source=...&target=...&max_hops=4` | Call chain analysis with per-hop details | Yes |
| `GET` | `/api/advanced/night-activity/{msisdn}?night_start=23&night_end=5` | Night activity detection with configurable hours | Yes |
| `GET` | `/api/advanced/top-contacts/{msisdn}?limit=20` | Top contacts with 7x24 communication heatmap | Yes |
| `POST` | `/api/advanced/report/{msisdn}` | Comprehensive dossier generation (configurable sections) | Yes |
| `GET` | `/api/advanced/stats/{msisdn}?days=30` | Activity summary stats | Yes |

### Entity Management

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/entities/persons?q=...&watchlist=true&limit=50&offset=0` | Person directory with search and pagination | Yes |
| `POST` | `/api/entities/persons` | Create person | Yes |
| `GET` | `/api/entities/persons/{person_id}` | Person detail with phones and devices | Yes |
| `PUT` | `/api/entities/persons/{person_id}` | Update person | Yes |
| `GET` | `/api/entities/phones/{msisdn}` | Phone number detail with CDR summary | Yes |
| `GET` | `/api/entities/devices/{imei}` | Device detail by IMEI | Yes |
| `GET` | `/api/entities/towers?min_lat=...&max_lat=...&city=...&limit=100` | Tower listing with geo/city filters | Yes |
| `GET` | `/api/entities/towers/{tower_id}` | Tower detail (by DB integer ID) | Yes |
| `GET` | `/api/entities/search?q=...&limit=20` | Unified search across all entities | Yes |

### Events

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/events/recent?limit=10` | Recent activity feed (calls + messages merged) | Yes |
| `GET` | `/api/events/calls?msisdn=...&caller=...&callee=...&from=...&to=...&status=...` | Call records with filters | Yes |
| `GET` | `/api/events/messages?msisdn=...&sender=...&receiver=...&from=...&to=...` | Message records with filters | Yes |
| `GET` | `/api/events/locations?msisdn=...&tower_id=...&from=...&to=...` | Location events | Yes |
| `GET` | `/api/events/timeline?msisdn=...&from=...&to=...&limit=200` | Unified timeline (calls + messages + locations + data sessions) | Yes |

### Case Management

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/cases?status=...&priority=...&limit=50&offset=0` | List cases (analysts see own, supervisors/admins see all) | Yes |
| `POST` | `/api/cases` | Create case | Yes |
| `GET` | `/api/cases/{case_id}` | Case detail with entities and insights | Yes |
| `PUT` | `/api/cases/{case_id}` | Update case | Yes |
| `DELETE` | `/api/cases/{case_id}` | Delete case | Yes |
| `POST` | `/api/cases/{case_id}/entities` | Link entity to case | Yes |
| `GET` | `/api/cases/{case_id}/entities` | List case entities | Yes |
| `POST` | `/api/cases/{case_id}/insights` | Save investigation insight | Yes |
| `GET` | `/api/cases/{case_id}/notebook` | Get case notebook (all insights) | Yes |

### Audit

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/audit/logs?user_id=...&action=...&from=...&to=...&limit=100` | Query audit logs | Admin/Auditor only |

### Common Query Parameters

Most list endpoints support date range filtering:
- `from` (alias for `from_date`): ISO 8601 datetime, e.g., `2026-01-01T00:00:00`
- `to` (alias for `to_date`): ISO 8601 datetime, e.g., `2026-01-31T23:59:59`
- `limit`: Maximum results (varies per endpoint, typically 50-500)
- `offset`: Pagination offset

---

## Frontend Pages

| Page | Route | Description |
|------|-------|-------------|
| **Dashboard** | `/` | Stats overview, quick search, recent activity, quick actions |
| **Copilot** | `/copilot` | Split-panel: AI chat (left) + investigation tabs (right) with 6 tabs |
| **Entities** | `/entities` | Person directory with expandable rows showing phones, devices, SIMs |
| **Entity Detail** | `/entities/:id` | Full person profile with linked phones, devices, CDR table |
| **Cases** | `/cases` | Case cards with status/priority filters, create modal |
| **Case Detail** | `/cases/:id` | Entities tab, notebook tab (insights), timeline tab |
| **Map** | `/map` | Full-screen Leaflet map with tower markers, movement trails |
| **Analytics** | `/analytics` | Contact analysis, Common Contacts, Co-location, Anomalies |
| **Advanced Analytics** | `/advanced` | 10-tab investigation tools: Tower Dump, Geofence, Pattern of Life, Identity Changes, Common Numbers, Call Chain, Night Activity, Top Contacts, Report, Stats |
| **Audit Log** | `/audit` | Admin-only log viewer with filters (user, action, date range) |
| **Login** | `/login` | Authentication page |

### Copilot Investigation Tabs

The copilot right panel has 6 tabs in this order:

1. **Pattern of Life** - Behavioral profile: sleep/work/weekend locations, hourly and weekly activity histograms, regular routes, routine score
2. **Tools** - 10 one-click investigation tools that execute directly (no modals/popups) -- tower dump, geofence, pattern of life, identity changes, common numbers, call chain, night activity, top contacts, report, stats
3. **Timeline** - Chronological events grouped by date with sticky date headers, type filters (calls, SMS, locations), and proper date formatting
4. **Map** - Movement flow visualization with numbered stops (A -> 1 -> 2 -> ... -> Z), dwell times, gradient trail, and journey log sidebar
5. **Contacts** - Expandable conversations per contact showing messages and call transcripts in a conversation view
6. **[Target Name]** - Person profile with linked phones, devices, risk score, metadata (tab label shows the target's actual name, e.g., "Rohit Singh", not a generic "Entity" label)

---

## Quick Start

### Prerequisites
- Docker and Docker Compose
- SSH access to deployment VM (or run locally)

### Deploy

```bash
# Clone
git clone https://github.com/Manikanta-Reddy-Pasala/TelecomIntelligence.git
cd TelecomIntelligence

# Deploy (builds, starts, seeds database, builds LLM model)
./deploy.sh setup
```

### Run Locally (Development)

```bash
# Start infrastructure
docker compose up -d postgres ollama

# Backend
cd backend
pip install -r requirements.txt
python seed_data.py              # Seed database
uvicorn main:app --reload        # http://localhost:8000

# Frontend
cd frontend
npm install
npm run dev                      # http://localhost:5173

# Build custom LLM model (pulls phi3:mini, builds tiac-analyst, removes base)
cd backend/ollama && ./train.sh
```

### Login Credentials

| Username | Password | Role |
|----------|----------|------|
| analyst1 | `Analyst@Tiac#2026` | Analyst |
| analyst2 | `Analyst2@Sec!2026` | Analyst |
| supervisor1 | `Sup3rvisor!Tiac#26` | Supervisor |
| admin | `Adm1n@Tiac$2026!` | Admin |
| auditor1 | `Aud1t0r@Sec#2026` | Auditor |

### Test MSISDNs (from seed data)

| MSISDN | Pattern |
|--------|---------|
| +919656152900 | Organized network member |
| +919590122159 | Organized network member |
| +919845122940 | Impossible travel suspect |
| +919679984033 | Contact burst (1000+ new contacts in 5 days) |
| +919620332086 | Co-location pair |
| +919866162966 | Co-location pair |

### Example Copilot Queries

```
Give all info about +919656152900
Show contact network for +919845122940
Check anomalies for +919845122940
Show movement trail for +919679984033
Who contacted +919590122159 recently?
Find common contacts between +919656152900 and +919590122159
Co-location check +919620332086 and +919866162966
```

---

## Deployment

### Docker Compose Services

| Service | Image | Port | Resources |
|---------|-------|------|-----------|
| postgres | postgres:16-alpine | 5432 | Persistent volume |
| ollama | ollama/ollama:latest | 11434 | 2GB memory limit |
| backend | tiac-backend (Python 3.12) | 8000 | FastAPI + uvicorn |
| frontend | tiac-frontend (nginx) | 3000 | Static React build |

### Deploy Script Commands

```bash
./deploy.sh setup       # Full setup (stop existing, sync, build, start, seed)
./deploy.sh start       # Start services
./deploy.sh stop        # Stop all services
./deploy.sh seed        # Re-seed database
./deploy.sh sync        # Sync files and rebuild
./deploy.sh logs [svc]  # Tail logs (default: backend)
./deploy.sh status      # Show container status
./deploy.sh pull-model  # Pull Ollama model
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://tiac:tiac123@localhost:5432/tiac` | PostgreSQL connection string |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `tiac-analyst` | Ollama model name (custom model built from phi3:mini) |
| `SECRET_KEY` | (hardcoded default) | JWT signing key |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173,http://localhost:5174` | Allowed CORS origins |

---

## Security and Compliance

- **JWT Authentication** with configurable expiry (default 8 hours / 480 minutes)
- **Role-Based Access Control** (analyst, supervisor, admin, auditor)
- **Full Audit Trail** - every copilot query, LLM prompt, response, and data access is logged to `audit_logs` table
- **Evidence Classification** - each output is labeled (Fact, Inference, Model Summary, Analyst Note)
- **No External API Calls** - LLM runs locally via Ollama (air-gap compatible)
- **Encryption** - TLS in transit (configure via nginx), PostgreSQL at rest
- **Role-based visibility** - analysts see only their assigned cases; supervisors/admins see all

---

## Tech Stack Details

### Backend Dependencies
- FastAPI 0.115 - async web framework
- SQLAlchemy 2.0 - async ORM with PostgreSQL
- asyncpg - async PostgreSQL driver
- Pydantic 2.9 - data validation
- python-jose - JWT tokens
- bcrypt 4.2 - password hashing
- httpx - async HTTP client (for Ollama)

### Frontend Dependencies
- React 18.3 + Vite 6
- TanStack Query 5 - data fetching and caching
- React Router 6 - client-side routing
- Tailwind CSS 3.4 - utility-first styling
- Leaflet + react-leaflet - interactive maps
- Recharts - charts and timelines
- Lucide React - icon system
- date-fns - date formatting
- Axios - HTTP client

### Project Structure

```
TelecomCopilot/
  backend/
    api/
      auth.py              # JWT authentication endpoints
      copilot.py           # AI copilot chat endpoint
      analytics.py         # Core analytics (contacts, movement, anomalies)
      advanced_analytics.py # 10 investigation tools
      entities.py          # Entity CRUD (persons, phones, devices, towers)
      events.py            # CDR, messages, timeline, locations
      investigation.py     # Case management
      audit.py             # Audit log queries
      deps.py              # Dependency injection (DB session, auth)
    services/
      copilot.py           # CopilotService (query processing pipeline)
      graph_analytics.py   # Contact network, shortest path, common contacts
      geo_analytics.py     # Movement trail, co-location, dwell times, heatmap
      anomaly_detection.py # Impossible travel, stored anomalies
      entity_resolution.py # Unified search
      audit_service.py     # Audit logging
      content_intelligence.py # Content analysis
    models/
      database.py          # SQLAlchemy models (Person, PhoneNumber, CallRecord, etc.)
    schemas/               # Pydantic request/response models
    ollama/
      Modelfile            # Custom model definition (phi3:mini base)
      train.sh             # Model build script
      training/
        dataset.jsonl      # 21 training examples
        finetune.py        # Unsloth QLoRA fine-tuning script
    config.py              # Environment configuration
    main.py                # FastAPI app entry point
    seed_data.py           # Database seeder (25k calls, 12k messages, 31k locations, 8k data sessions)
    requirements.txt       # Python dependencies
  frontend/
    src/
      pages/               # React page components
      components/          # Shared UI components
      services/            # API client services
      context/             # React context providers
      hooks/               # Custom React hooks
  docker-compose.yml       # 4-service Docker stack
  deploy.sh                # Deployment automation script
```

---

## License

Internal use only. Not for redistribution.
