# TIAC - Telecom Intelligence Analyst Copilot

An AI-powered investigation platform for telecom CDR (Call Detail Record) analysis. TIAC enables intelligence analysts to investigate phone numbers, detect anomalies, trace movement patterns, and uncover communication networks through a conversational AI copilot interface.

---

## What It Does (Non-Technical)

TIAC is a tool built for telecom intelligence analysts who need to investigate phone activity. Instead of writing database queries manually, analysts can **ask questions in plain English** and get instant answers backed by data.

### Key Capabilities

- **Ask Questions Naturally**: "Give all info about +919656152900" instantly returns the person's profile, call history, movement trail, contact network, and anomaly alerts
- **Movement Tracking**: See where a phone traveled on a map - from tower to tower, with timestamps and dwell times at each location
- **Contact Network Visualization**: Interactive graph showing who a target communicates with and how those contacts connect to each other
- **Anomaly Detection**: Automatically flags suspicious behavior - impossible travel (appearing at distant locations within minutes), sudden contact bursts, SIM swaps, unusual call times
- **Timeline View**: Chronological view of all calls, messages, and location events for any phone number
- **Case Management**: Create investigation cases, link entities (phones, persons, devices), and save insights as you investigate
- **Date Range Filtering**: Focus your investigation on a specific time period
- **Full Audit Trail**: Every query, every data access is logged for compliance

### Who Is It For

- **Analysts**: Primary investigators who query the system and build cases
- **Supervisors**: Review findings and approve escalations
- **Auditors**: Monitor system usage and ensure compliance
- **Admins**: Manage users and system configuration

---

## Technical Architecture

### Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18, Vite, Tailwind CSS | Modern SPA with dark theme |
| **Backend** | Python 3.12, FastAPI, SQLAlchemy (async) | REST API with async PostgreSQL |
| **Database** | PostgreSQL 16 | Relational storage for all entities and events |
| **AI/LLM** | Ollama (tinyllama) | Natural language response generation |
| **Visualization** | Leaflet (maps), react-force-graph-2d (networks), Recharts (charts) | Interactive data visualization |
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
     +-------------+  +-------------+  +-------------+
```

### Data Model

```
persons ─── phone_numbers ─── sims
   │              │
   └── devices    ├── call_records (CDR)
                  ├── messages (SMS/MMS)
                  ├── location_events (tower pings)
                  └── data_sessions

cases ─── case_entities ─── case_insights

users ─── audit_logs
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
| Call Records | CDR data (caller, callee, duration, tower) | 25,000+ |
| Messages | SMS/MMS with content previews | 12,000+ |
| Location Events | Tower pings with signal strength | 31,500+ |
| Data Sessions | Mobile data usage records | 8,000 |
| Anomaly Alerts | Detected suspicious patterns | 10 |
| Cases | Investigation cases | 5 |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | JWT authentication (JSON body) |
| `GET` | `/api/auth/me` | Current user profile |
| `POST` | `/api/copilot/chat` | AI copilot - main investigation endpoint |
| `GET` | `/api/analytics/dashboard-stats` | Dashboard overview counts |
| `GET` | `/api/analytics/contacts/{msisdn}` | Contact network with graph data |
| `GET` | `/api/analytics/common-contacts` | Shared contacts between two numbers |
| `GET` | `/api/analytics/shortest-path` | BFS shortest path between MSISDNs |
| `GET` | `/api/analytics/colocation` | Co-location detection |
| `GET` | `/api/analytics/movement/{msisdn}` | Movement trail |
| `GET` | `/api/analytics/anomalies` | All anomaly alerts |
| `GET` | `/api/entities/persons` | Person directory |
| `GET` | `/api/entities/phones/{msisdn}` | Phone detail with CDR summary |
| `GET` | `/api/entities/towers` | Tower listing with geo filters |
| `GET` | `/api/entities/search` | Unified search across all entities |
| `GET` | `/api/events/calls` | Call records with filters |
| `GET` | `/api/events/messages` | Message records |
| `GET` | `/api/events/timeline` | Unified timeline (calls + messages + locations) |
| `GET` | `/api/events/recent` | Recent activity feed |
| `CRUD` | `/api/cases` | Case management |
| `POST` | `/api/cases/{id}/entities` | Link entity to case |
| `POST` | `/api/cases/{id}/insights` | Save investigation insight |
| `GET` | `/api/audit/logs` | Audit trail (admin/auditor only) |

---

## AI Copilot - How It Works

The copilot is the core intelligence layer. When you ask a question:

### 1. Parameter Extraction (Regex - Instant)
MSISDNs are extracted via regex `\+?\d{10,15}` - no LLM dependency for parameter extraction. This makes it reliable and fast.

### 2. Intent Classification (Keyword-Based - Instant)
Queries are classified into: `comprehensive`, `relationship`, `location`, `timeline`, `content`, `pattern` based on keyword matching. No LLM latency.

### 3. Comprehensive Data Fetching (PostgreSQL - ~100ms)
For the detected MSISDN, the system fetches ALL relevant data in parallel:
- **Entity profile** (person, phones, devices, SIMs)
- **Call records** (last 50, with date range filter)
- **Messages** (last 30, with date range filter)
- **Movement trail** (location events with tower coordinates)
- **Contact network** (including inter-contact edges)
- **Anomaly alerts** (stored + real-time impossible travel detection)

### 4. LLM Response Generation (Ollama/tinyllama - ~3s)
The structured data summary is sent to the LLM for a natural language analyst-grade summary. If LLM is unavailable or slow (>15s), a structured fallback is used.

### 5. Response Structure
The copilot returns everything the frontend needs in one response:
```json
{
  "response": "LLM-generated analyst summary",
  "confidence": 0.9,
  "evidence": [...],      // Raw data as JSON (expandable sections)
  "timeline": [...],      // Calls + messages for timeline chart
  "locations": [...],     // Tower trail for movement map
  "graph": {              // Contact network for force graph
    "nodes": [...],
    "edges": [...]        // Includes inter-contact edges
  },
  "entity": {...},        // Person profile for entity card
  "suggestions": [...]    // Follow-up query suggestions
}
```

### Anomaly Detection Algorithms

| Algorithm | Description |
|-----------|-------------|
| **Impossible Travel** | Haversine distance / time between consecutive tower pings. Speed > 300 km/h flags alert |
| **Contact Burst** | New unique contacts in 7-day window vs historical baseline. Threshold: 10+ new contacts |
| **Volume Spike** | Daily call count vs 90-day baseline. Flags when > mean + 2*stddev |
| **Unusual Call Time** | Calls between midnight and 5 AM |
| **Co-location** | Two MSISDNs at same tower within configurable time window |

---

## Frontend Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Stats overview, quick search, recent activity, quick actions |
| **Copilot** | Split-panel: AI chat (40%) + evidence viewer (60%) with 5 tabs |
| **Entities** | Person directory with expandable rows showing phones, devices, SIMs |
| **Entity Detail** | Full person profile with linked phones, devices, CDR table |
| **Cases** | Case cards with status/priority filters, create modal |
| **Case Detail** | Entities tab, notebook tab (insights), timeline tab |
| **Map** | Full-screen Leaflet map with tower markers, movement trails |
| **Analytics** | 4-tab: Contact Network graph, Common Contacts, Co-location, Anomalies |
| **Audit Log** | Admin-only log viewer with filters (user, action, date range) |

### Copilot Evidence Tabs

1. **Evidence** - Expandable JSON sections showing raw data (entity profile, CDR records, messages, contacts, anomalies, locations)
2. **Timeline** - Scatter chart showing calls, SMS, location events chronologically
3. **Map** - Movement flow visualization with numbered stops (A -> 1 -> 2 -> ... -> Z), dwell times, gradient trail, and journey log sidebar
4. **Graph** - Force-directed network graph with color-coded nodes (by interaction intensity), inter-contact edges, glow effects, click-to-zoom
5. **Entity Card** - Person profile with linked phones, devices, metadata

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- SSH access to deployment VM (or run locally)

### Deploy

```bash
# Clone
git clone https://github.com/Manikanta-Reddy-Pasala/TelecomIntelligence.git
cd TelecomIntelligence

# Deploy (builds, starts, seeds database, pulls LLM model)
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

# Pull LLM model
docker exec tiac_ollama ollama pull tinyllama
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

---

## Security & Compliance

- **JWT Authentication** with configurable expiry (default 8 hours)
- **Role-Based Access Control** (analyst, supervisor, admin, auditor)
- **Full Audit Trail** - every query, LLM prompt, response, and data access is logged
- **Evidence Classification** - each output is labeled (Fact, Inference, Model Summary, Analyst Note)
- **No External API Calls** - LLM runs locally via Ollama (air-gap compatible)
- **Encryption** - TLS in transit (configure via nginx), PostgreSQL at rest

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
- TanStack Query 5 - data fetching & caching
- React Router 6 - client-side routing
- Tailwind CSS 3.4 - utility-first styling
- Leaflet + react-leaflet - interactive maps
- react-force-graph-2d - network visualization
- Recharts - charts and timelines
- Lucide React - icon system
- date-fns - date formatting
- Axios - HTTP client

---

## License

Internal use only. Not for redistribution.
