import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import OLLAMA_URL, OLLAMA_MODEL
from models.database import (
    Person, PhoneNumber, Device, SIM, Tower, CallRecord, Message,
    LocationEvent, AnomalyAlert, Case, CaseEntity,
)
from schemas.copilot import CopilotResponse, Evidence, QueryPlan
from services.audit_service import AuditService
from services.graph_analytics import GraphAnalyticsService
from services.geo_analytics import GeoAnalyticsService
from services.anomaly_detection import AnomalyDetectionService

logger = logging.getLogger(__name__)

# Regex to find MSISDNs in text
_MSISDN_RE = re.compile(r'\+?\d{10,15}')
_IMEI_RE = re.compile(r'\b\d{15}\b')

# Keywords for intent classification
_INTENT_KEYWORDS = {
    "relationship": ["contact", "contacts", "network", "called", "communicated", "common", "who called", "who contacted", "relationship"],
    "location": ["location", "tower", "movement", "trail", "where", "co-location", "colocation", "traveled", "travel"],
    "timeline": ["timeline", "history", "chronolog", "when", "activity", "events"],
    "content": ["message", "sms", "text", "content", "conversation", "topic"],
    "pattern": ["anomal", "unusual", "pattern", "spike", "burst", "suspicious", "impossible"],
    # Advanced investigation tools
    "tower_dump": ["tower dump", "tower-dump", "towerdump", "who was at tower", "phones at tower", "devices at tower", "who was at", "phones at", "devices near"],
    "geofence": ["geofence", "geo-fence", "geo fence", "area surveillance", "bounding box", "zone", "area", "within bounds"],
    "pattern_of_life": ["pattern of life", "daily routine", "sleep location", "work location", "routine", "behavioral", "behaviour"],
    "identity_change": ["imei change", "sim change", "sim swap", "device change", "identity change", "new device", "new sim"],
    "common_numbers": ["common number", "shared contact", "common contact", "overlap", "mutual contact"],
    "call_chain": ["call chain", "chain analysis", "connection chain", "degrees of separation", "path between", "linked to"],
    "night_activity": ["night activity", "night calls", "late night", "midnight", "nocturnal", "after hours"],
    "top_contacts": ["top contact", "most called", "frequently called", "frequent contact", "heatmap", "top numbers"],
    "report": ["report", "dossier", "full report", "generate report", "comprehensive report"],
    "stats": ["stats", "statistics", "summary stats", "activity stats", "quick stats"],
    "search": ["search", "find message", "find messages", "find text", "search text", "search message", "search call", "containing", "mentions", "said", "wrote"],
}


class CopilotService:

    async def process_query(
        self,
        db: AsyncSession,
        message: str,
        case_id: Optional[int],
        user_id: int,
        history: list[dict],
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> CopilotResponse:
        """Main entry point: extract params, classify, execute comprehensively, respond."""

        # Parse date range from explicit params or extract from message
        dt_from = None
        dt_to = None
        if date_from:
            try:
                dt_from = datetime.strptime(date_from, "%Y-%m-%d")
            except ValueError:
                pass
        if date_to:
            try:
                dt_to = datetime.strptime(date_to, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            except ValueError:
                pass

        # Extract date ranges from natural language in message
        if not dt_from and not dt_to:
            dt_from, dt_to = self._extract_date_range(message)

        # Step 1: Extract parameters directly with regex (no LLM dependency)
        msisdns = _MSISDN_RE.findall(message)
        msisdn = msisdns[0] if msisdns else None
        target_msisdn = msisdns[1] if len(msisdns) > 1 else None

        # Normalize MSISDN
        if msisdn and not msisdn.startswith('+'):
            msisdn = '+' + msisdn

        # Extract person names (simple heuristic: capitalized words after "person" or "name")
        person_name = None
        name_match = re.search(r'(?:person|name|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', message)
        if name_match:
            person_name = name_match.group(1)

        # Step 2: Classify intent (keyword-based, fast & reliable)
        intent = self._classify_intent_keywords(message)

        # Step 3: Build plan
        plan = {}
        if msisdn:
            plan["msisdn"] = msisdn
        if target_msisdn:
            plan["target_msisdn"] = target_msisdn
        if person_name:
            plan["person_name"] = person_name
        if dt_from:
            plan["date_from"] = dt_from.strftime("%Y-%m-%d")
        if dt_to:
            plan["date_to"] = dt_to.strftime("%Y-%m-%d")

        # Step 4: Execute comprehensively - fetch ALL relevant data for the MSISDN
        result = await self._execute_comprehensive(db, message, intent, msisdn, target_msisdn, person_name, dt_from, dt_to)

        # Step 5: Generate response text
        response_text = await self._generate_response(message, result, intent, msisdn)

        # Step 6: Build suggestions
        suggestions = self._generate_suggestions(intent, msisdn, target_msisdn)

        # Audit
        try:
            await AuditService.log(
                db=db, user_id=user_id, action="copilot_query",
                query_text=message, llm_prompt=f"intent={intent}",
                llm_response=response_text[:2000],
                data_accessed={"intent": intent, "msisdn": msisdn},
            )
        except Exception as e:
            logger.warning("Failed to log audit: %s", e)

        confidence = 0.9 if result["has_data"] else 0.3

        return CopilotResponse(
            response=response_text,
            evidence=result["evidence"],
            query_plan=QueryPlan(intent=intent, parameters=plan, description=f"Classified as '{intent}' query"),
            confidence=confidence,
            suggestions=suggestions,
            timeline=result["timeline"],
            locations=result["locations"],
            graph=result["graph"],
            entity=result["entity"],
            pattern_of_life=result.get("pattern_of_life"),
        )

    async def get_suggestions(self, db: AsyncSession, case_id: int) -> list[str]:
        stmt = select(CaseEntity).where(CaseEntity.case_id == case_id)
        result = await db.execute(stmt)
        entities = result.scalars().all()
        phones = [e.entity_id for e in entities if e.entity_type == "phone"]
        if phones:
            return [
                f"Show all info about {phones[0]}",
                f"Show contact network for {phones[0]}",
                f"Check anomalies for {phones[0]}",
            ]
        return ["Search for an MSISDN to begin investigation"]

    # ------------------------------------------------------------------
    # Intent classification (keyword-based, no LLM needed)
    # ------------------------------------------------------------------

    def _extract_date_range(self, message: str) -> tuple[Optional[datetime], Optional[datetime]]:
        """Extract date range from natural language in the message."""
        msg_lower = message.lower()
        now = datetime.utcnow()

        # "last N days"
        m = re.search(r'last\s+(\d+)\s+days?', msg_lower)
        if m:
            days = int(m.group(1))
            return now - timedelta(days=days), now

        # "last N hours"
        m = re.search(r'last\s+(\d+)\s+hours?', msg_lower)
        if m:
            hours = int(m.group(1))
            return now - timedelta(hours=hours), now

        # "last week"
        if "last week" in msg_lower:
            return now - timedelta(days=7), now

        # "last month"
        if "last month" in msg_lower:
            return now - timedelta(days=30), now

        # "last 3 months" / "last N months"
        m = re.search(r'last\s+(\d+)\s+months?', msg_lower)
        if m:
            months = int(m.group(1))
            return now - timedelta(days=months * 30), now

        # "today"
        if "today" in msg_lower:
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            return start, now

        # "yesterday"
        if "yesterday" in msg_lower:
            start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            end = start.replace(hour=23, minute=59, second=59)
            return start, end

        # "this week"
        if "this week" in msg_lower:
            start = now - timedelta(days=now.weekday())
            return start.replace(hour=0, minute=0, second=0, microsecond=0), now

        # "in January" / "in March" etc.
        months_map = {"january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
                       "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
                       "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
        for month_name, month_num in months_map.items():
            if f"in {month_name}" in msg_lower or f"during {month_name}" in msg_lower:
                year = now.year if month_num <= now.month else now.year - 1
                start = datetime(year, month_num, 1)
                if month_num == 12:
                    end = datetime(year + 1, 1, 1) - timedelta(seconds=1)
                else:
                    end = datetime(year, month_num + 1, 1) - timedelta(seconds=1)
                return start, end

        # No date range found - return None (use all data)
        return None, None

    def _classify_intent_keywords(self, message: str) -> str:
        msg_lower = message.lower()

        # Check for "all info" / "everything" type queries
        if any(kw in msg_lower for kw in ["all info", "everything", "full details", "investigate"]):
            return "comprehensive"

        # Check ADVANCED tools FIRST (more specific keywords)
        advanced_intents = [
            "tower_dump", "geofence", "pattern_of_life", "identity_change",
            "common_numbers", "call_chain", "night_activity", "top_contacts",
            "report", "stats", "search",
        ]
        for intent in advanced_intents:
            keywords = _INTENT_KEYWORDS.get(intent, [])
            if any(kw in msg_lower for kw in keywords):
                return intent

        # Then check basic intents
        basic_intents = ["relationship", "location", "timeline", "content", "pattern"]
        for intent in basic_intents:
            keywords = _INTENT_KEYWORDS.get(intent, [])
            if any(kw in msg_lower for kw in keywords):
                return intent

        return "comprehensive"  # Default: show everything

    # ------------------------------------------------------------------
    # Comprehensive data fetching
    # ------------------------------------------------------------------

    async def _execute_comprehensive(
        self, db: AsyncSession, message: str, intent: str,
        msisdn: Optional[str], target_msisdn: Optional[str], person_name: Optional[str],
        dt_from: Optional[datetime] = None, dt_to: Optional[datetime] = None,
    ) -> dict:
        """Fetch ALL relevant data for the query, populating all frontend tabs."""

        result = {
            "evidence": [],
            "timeline": [],
            "locations": [],
            "graph": None,
            "entity": None,
            "pattern_of_life": None,
            "has_data": False,
            "summary_parts": [],
        }

        if not msisdn and person_name:
            # Search for person, get their MSISDNs
            stmt = select(Person).options(selectinload(Person.phone_numbers)).where(
                Person.name.ilike(f"%{person_name}%")
            ).limit(1)
            res = await db.execute(stmt)
            person = res.scalar_one_or_none()
            if person and person.phone_numbers:
                msisdn = person.phone_numbers[0].msisdn

        if not msisdn and not person_name and intent != "search":
            # No identifiers found and not a search query - can't do much
            return result

        if msisdn:
            # === ENTITY INFO ===
            entity_data = await self._fetch_entity(db, msisdn)
            if entity_data:
                result["entity"] = entity_data
                result["has_data"] = True
                result["evidence"].append(Evidence(
                    source="Entity Profile",
                    data={
                        "msisdn": msisdn,
                        "name": entity_data.get("name", "Unknown"),
                        "carrier": entity_data.get("carrier"),
                        "status": entity_data.get("status"),
                        "nationality": entity_data.get("nationality"),
                        "risk_score": entity_data.get("risk_score"),
                        "watchlist": entity_data.get("watchlist", False),
                        "phones": entity_data.get("phones", []),
                        "devices": entity_data.get("devices", []),
                    },
                    relevance=1.0,
                ))
                result["summary_parts"].append(
                    f"MSISDN {msisdn} belongs to {entity_data.get('name', 'Unknown')} "
                    f"({entity_data.get('carrier', 'Unknown carrier')}), "
                    f"status: {entity_data.get('status', 'unknown')}"
                )

            # === CALL RECORDS (timeline + evidence) ===
            if intent in ("comprehensive", "timeline", "entity_lookup"):
                calls = await self._fetch_calls(db, msisdn, limit=50, dt_from=dt_from, dt_to=dt_to)
                if calls:
                    result["has_data"] = True
                    call_evidence = []
                    for c in calls:
                        other = c.callee_msisdn if c.caller_msisdn == msisdn else c.caller_msisdn
                        direction = "outgoing" if c.caller_msisdn == msisdn else "incoming"
                        transcript_preview = f" | {c.transcript[:60]}..." if c.transcript else ""
                        call_row = {
                            "type": "call",
                            "timestamp": c.start_time.isoformat(),
                            "from": c.caller_msisdn,
                            "to": c.callee_msisdn,
                            "duration": c.duration_seconds,
                            "status": c.status,
                            "call_type": c.call_type,
                            "transcript": c.transcript,
                            "description": f"{direction.title()} call {'to' if direction == 'outgoing' else 'from'} {other} ({c.duration_seconds}s){transcript_preview}",
                        }
                        result["timeline"].append(call_row)
                        call_evidence.append({
                            "direction": direction,
                            "other_party": other,
                            "timestamp": c.start_time.isoformat(),
                            "duration_sec": c.duration_seconds,
                            "status": c.status,
                            "call_type": c.call_type,
                            "transcript": c.transcript,
                        })
                    result["evidence"].append(Evidence(
                        source="Call Detail Records",
                        data={"total": len(calls), "records": call_evidence},
                        relevance=0.9,
                    ))
                    result["summary_parts"].append(f"Found {len(calls)} recent call records")

            # === MESSAGES (timeline + evidence) ===
            if intent in ("comprehensive", "timeline", "content"):
                messages = await self._fetch_messages(db, msisdn, limit=30, dt_from=dt_from, dt_to=dt_to)
                if messages:
                    result["has_data"] = True
                    msg_evidence = []
                    for m in messages:
                        direction = "sent" if m.sender_msisdn == msisdn else "received"
                        other = m.receiver_msisdn if m.sender_msisdn == msisdn else m.sender_msisdn
                        result["timeline"].append({
                            "type": "sms",
                            "timestamp": m.timestamp.isoformat(),
                            "from": m.sender_msisdn,
                            "to": m.receiver_msisdn,
                            "description": f"SMS {direction} {'to' if direction == 'sent' else 'from'} {other}",
                            "preview": m.content_preview,
                        })
                        msg_evidence.append({
                            "direction": direction,
                            "other_party": other,
                            "timestamp": m.timestamp.isoformat(),
                            "type": m.message_type,
                            "preview": m.content_preview,
                        })
                    result["evidence"].append(Evidence(
                        source="Messages",
                        data={"total": len(messages), "records": msg_evidence},
                        relevance=0.85,
                    ))
                    result["summary_parts"].append(f"Found {len(messages)} messages")

            # Sort timeline by timestamp
            result["timeline"].sort(key=lambda x: x["timestamp"], reverse=True)

            # === LOCATION / MOVEMENT (map) ===
            if intent in ("comprehensive", "location"):
                trail = await GeoAnalyticsService.get_movement_trail(db, msisdn, dt_from, dt_to)
                if trail:
                    result["has_data"] = True
                    result["locations"] = trail[:200]
                    result["evidence"].append(Evidence(
                        source="Location Trail",
                        data={
                            "total_points": len(trail),
                            "sample_locations": trail[:10],
                        },
                        relevance=0.85,
                    ))
                    result["summary_parts"].append(f"Movement trail: {len(trail)} location points")

            # === CONTACT NETWORK (graph with inter-contact edges) ===
            if intent in ("comprehensive", "relationship"):
                contacts = await GraphAnalyticsService.get_contact_network(db, msisdn)
                if contacts:
                    result["has_data"] = True
                    top_contacts = contacts[:20]
                    top_msisdns = {c["msisdn"] for c in top_contacts}
                    nodes = [{"id": msisdn, "msisdn": msisdn, "label": msisdn[-6:], "is_target": True, "weight": 10}]
                    edges = []
                    contact_evidence = []

                    for c in top_contacts:
                        total = c.get("outgoing_calls", 0) + c.get("incoming_calls", 0) + c.get("outgoing_messages", 0) + c.get("incoming_messages", 0)
                        calls_count = c.get("outgoing_calls", 0) + c.get("incoming_calls", 0)
                        nodes.append({
                            "id": c["msisdn"], "msisdn": c["msisdn"],
                            "label": c["msisdn"][-6:], "is_target": False,
                            "weight": total, "call_count": calls_count,
                        })
                        edges.append({
                            "source": msisdn, "target": c["msisdn"],
                            "weight": total, "call_count": calls_count,
                        })
                        contact_evidence.append({
                            "msisdn": c["msisdn"],
                            "outgoing_calls": c.get("outgoing_calls", 0),
                            "incoming_calls": c.get("incoming_calls", 0),
                            "outgoing_messages": c.get("outgoing_messages", 0),
                            "incoming_messages": c.get("incoming_messages", 0),
                            "total_duration_sec": c.get("total_call_duration", 0),
                        })

                    # Find inter-contact edges (who among the top contacts also talk to each other)
                    inter_contacts_checked = set()
                    for c in top_contacts[:5]:  # Check top 5 for cross-links (balanced speed vs detail)
                        c_contacts = await GraphAnalyticsService.get_contact_network(db, c["msisdn"])
                        for cc in c_contacts:
                            if cc["msisdn"] in top_msisdns and cc["msisdn"] != msisdn:
                                pair = tuple(sorted([c["msisdn"], cc["msisdn"]]))
                                if pair not in inter_contacts_checked:
                                    inter_contacts_checked.add(pair)
                                    inter_total = cc.get("outgoing_calls", 0) + cc.get("incoming_calls", 0)
                                    if inter_total > 5:  # Only show meaningful connections
                                        edges.append({
                                            "source": c["msisdn"], "target": cc["msisdn"],
                                            "weight": inter_total,
                                            "call_count": inter_total,
                                            "is_inter": True,
                                        })

                    result["graph"] = {"nodes": nodes, "edges": edges}
                    result["evidence"].append(Evidence(
                        source="Contact Network",
                        data={"total_contacts": len(contacts), "top_contacts": contact_evidence[:15]},
                        relevance=0.85,
                    ))
                    result["summary_parts"].append(f"Contact network: {len(contacts)} unique contacts")

            # === ANOMALIES (evidence) ===
            if intent in ("comprehensive", "pattern"):
                anomalies = await AnomalyDetectionService.get_anomalies_for_msisdn(db, msisdn)
                # Limit impossible travel to last 7 days to avoid flood of results
                seven_days_ago = datetime.utcnow() - timedelta(days=7)
                impossible = await AnomalyDetectionService.detect_impossible_travel(
                    db, msisdn, from_date=seven_days_ago
                )
                all_anomalies = []
                for a in anomalies:
                    all_anomalies.append({
                        "type": a.anomaly_type, "description": a.description,
                        "severity": a.severity, "detected_at": a.detected_at.isoformat(),
                    })
                # Cap impossible travel at top 5 most extreme
                impossible_sorted = sorted(impossible, key=lambda x: x.get("implied_speed_kmh", 0), reverse=True)[:5]
                all_anomalies.extend(impossible_sorted)
                if all_anomalies:
                    result["has_data"] = True
                    stored_count = len(anomalies)
                    realtime_count = len(impossible_sorted)
                    result["evidence"].append(Evidence(
                        source="Anomaly Detection",
                        data={
                            "stored_alerts": stored_count,
                            "realtime_impossible_travel": realtime_count,
                            "total_anomalies": stored_count + realtime_count,
                            "alerts": all_anomalies,
                        },
                        relevance=0.95,
                    ))
                    severity_counts = {}
                    for a in all_anomalies:
                        s = a.get("severity", "unknown")
                        severity_counts[s] = severity_counts.get(s, 0) + 1
                    sev_str = ", ".join(f"{v} {k}" for k, v in severity_counts.items())
                    result["summary_parts"].append(f"Anomalies: {len(all_anomalies)} alerts ({sev_str})")

            # === CO-LOCATION (if two MSISDNs) ===
            if target_msisdn and intent in ("comprehensive", "location"):
                colocations = await GeoAnalyticsService.find_colocation(db, msisdn, target_msisdn, 30)
                if colocations:
                    result["has_data"] = True
                    result["evidence"].append(Evidence(
                        source="Co-location Analysis",
                        data={"colocation_events": len(colocations), "msisdn1": msisdn, "msisdn2": target_msisdn,
                              "events": colocations[:20]},
                        relevance=0.9,
                    ))
                    result["summary_parts"].append(f"Co-location: {len(colocations)} events with {target_msisdn}")

            # ============================================================
            # ADVANCED INVESTIGATION TOOLS
            # ============================================================

            # --- PATTERN OF LIFE ---
            if intent in ("pattern_of_life", "comprehensive"):
                pol = await self._fetch_pattern_of_life(db, msisdn)
                if pol:
                    result["has_data"] = True
                    result["pattern_of_life"] = pol
                    result["evidence"].append(Evidence(
                        source="Pattern of Life",
                        data=pol,
                        relevance=0.9,
                    ))
                    sleep_tower = pol.get("sleep_location", {}).get("tower_id", "Unknown")
                    work_tower = pol.get("work_location", {}).get("tower_id", "Unknown")
                    result["summary_parts"].append(
                        f"Pattern of Life: sleeps near {sleep_tower}, works near {work_tower}, "
                        f"routine score: {pol.get('routine_score', 0):.0%}"
                    )
                    # Add key locations to map
                    for loc_type, loc_data in [("Sleep", pol.get("sleep_location")),
                                                ("Work", pol.get("work_location")),
                                                ("Weekend", pol.get("weekend_location"))]:
                        if loc_data and loc_data.get("latitude"):
                            result["locations"].append({
                                "latitude": loc_data["latitude"],
                                "longitude": loc_data["longitude"],
                                "tower_id": loc_data.get("tower_id", ""),
                                "city": loc_data.get("city", ""),
                                "timestamp": None,
                                "event_type": loc_type,
                                "signal_strength": None,
                            })

            # --- IDENTITY CHANGES (SIM/IMEI) ---
            if intent in ("identity_change", "comprehensive"):
                id_changes = await self._fetch_identity_changes(db, msisdn)
                if id_changes and id_changes.get("identity_changes"):
                    result["has_data"] = True
                    result["evidence"].append(Evidence(
                        source="Identity Changes (SIM/IMEI)",
                        data=id_changes,
                        relevance=0.9,
                    ))
                    result["summary_parts"].append(
                        f"Identity changes: {len(id_changes['identity_changes'])} detected, "
                        f"risk: {id_changes.get('risk_assessment', 'LOW')}"
                    )
                elif intent == "identity_change":
                    # Phone/entity not found for this MSISDN
                    result["evidence"].append(Evidence(
                        source="Identity Changes (SIM/IMEI)",
                        data={"message": f"No phone record found for MSISDN {msisdn}. Cannot check identity changes."},
                        relevance=0.5,
                    ))
                    result["summary_parts"].append(f"No identity change data available for {msisdn}")

            # --- NIGHT ACTIVITY ---
            if intent in ("night_activity",):
                night = await self._fetch_night_activity(db, msisdn, dt_from, dt_to)
                if night:
                    result["has_data"] = True
                    result["evidence"].append(Evidence(
                        source="Night Activity",
                        data=night,
                        relevance=0.9,
                    ))
                    result["summary_parts"].append(
                        f"Night activity: {night['total_night_calls']} calls, "
                        f"{night['total_night_messages']} messages between 11PM-5AM"
                    )

            # --- TOP CONTACTS ---
            if intent in ("top_contacts",):
                top = await self._fetch_top_contacts(db, msisdn, dt_from, dt_to)
                if top:
                    result["has_data"] = True
                    result["evidence"].append(Evidence(
                        source="Top Contacts",
                        data={"contacts": top},
                        relevance=0.85,
                    ))
                    if top:
                        result["summary_parts"].append(
                            f"Top contact: {top[0]['msisdn']} with {top[0]['total_interactions']} interactions"
                        )

            # --- ACTIVITY STATS ---
            if intent in ("stats",):
                stats = await self._fetch_stats(db, msisdn)
                if stats:
                    result["has_data"] = True
                    result["evidence"].append(Evidence(
                        source="Activity Statistics",
                        data=stats,
                        relevance=0.85,
                    ))
                    result["summary_parts"].append(
                        f"Stats: {stats['total_calls']} calls, {stats['total_messages']} messages, "
                        f"{stats['unique_contacts']} contacts, most active: {stats.get('most_active_day', '?')}"
                    )

            # --- CALL CHAIN (needs two MSISDNs) ---
            if intent == "call_chain" and target_msisdn:
                path = await GraphAnalyticsService.find_shortest_path(db, msisdn, target_msisdn, 4)
                if path:
                    result["has_data"] = True
                    result["evidence"].append(Evidence(
                        source="Call Chain Analysis",
                        data={"path": path, "hops": len(path) - 1, "source": msisdn, "target": target_msisdn},
                        relevance=0.95,
                    ))
                    result["summary_parts"].append(
                        f"Call chain: {msisdn} → {' → '.join(p[-6:] for p in path[1:])} ({len(path)-1} hops)"
                    )
                elif intent == "call_chain":
                    result["summary_parts"].append(f"No call chain found between {msisdn} and {target_msisdn} within 4 hops")

            # --- REPORT (dossier) ---
            if intent == "report":
                # Already fetching comprehensive data above, just add extra sections
                pol = await self._fetch_pattern_of_life(db, msisdn)
                if pol:
                    result["evidence"].append(Evidence(source="Pattern of Life", data=pol, relevance=0.9))
                id_ch = await self._fetch_identity_changes(db, msisdn)
                if id_ch:
                    result["evidence"].append(Evidence(source="Identity Changes", data=id_ch, relevance=0.9))
                night = await self._fetch_night_activity(db, msisdn, dt_from, dt_to)
                if night:
                    result["evidence"].append(Evidence(source="Night Activity", data=night, relevance=0.85))
                stats = await self._fetch_stats(db, msisdn)
                if stats:
                    result["evidence"].append(Evidence(source="Activity Statistics", data=stats, relevance=0.85))
                result["has_data"] = True
                result["summary_parts"].append("Full investigation report generated with all sections")

        # === ALWAYS populate timeline if we have msisdn and timeline is empty ===
        if msisdn and not result["timeline"] and intent not in ("search",):
            calls = await self._fetch_calls(db, msisdn, limit=30, dt_from=dt_from, dt_to=dt_to)
            for c in calls:
                other = c.callee_msisdn if c.caller_msisdn == msisdn else c.caller_msisdn
                direction = "outgoing" if c.caller_msisdn == msisdn else "incoming"
                transcript_preview = f" | {c.transcript[:50]}..." if c.transcript else ""
                result["timeline"].append({
                    "type": "call", "timestamp": c.start_time.isoformat(),
                    "from": c.caller_msisdn, "to": c.callee_msisdn,
                    "duration": c.duration_seconds, "status": c.status,
                    "transcript": c.transcript,
                    "description": f"{direction.title()} call {'to' if direction == 'outgoing' else 'from'} {other} ({c.duration_seconds}s){transcript_preview}",
                })
            messages = await self._fetch_messages(db, msisdn, limit=20, dt_from=dt_from, dt_to=dt_to)
            for m in messages:
                direction = "sent" if m.sender_msisdn == msisdn else "received"
                other = m.receiver_msisdn if m.sender_msisdn == msisdn else m.sender_msisdn
                result["timeline"].append({
                    "type": "sms", "timestamp": m.timestamp.isoformat(),
                    "from": m.sender_msisdn, "to": m.receiver_msisdn,
                    "description": f"SMS {direction} {'to' if direction == 'sent' else 'from'} {other}",
                    "preview": m.content_preview,
                })
            result["timeline"].sort(key=lambda x: x["timestamp"], reverse=True)

        # === ALWAYS populate graph if we have msisdn and graph is empty ===
        if msisdn and not result["graph"] and intent not in ("search",):
            contacts = await GraphAnalyticsService.get_contact_network(db, msisdn, dt_from, dt_to)
            if contacts:
                top_contacts = contacts[:20]
                nodes = [{"id": msisdn, "msisdn": msisdn, "label": msisdn[-6:], "is_target": True, "weight": 10}]
                edges = []
                for c in top_contacts:
                    total = c.get("outgoing_calls", 0) + c.get("incoming_calls", 0) + c.get("outgoing_messages", 0) + c.get("incoming_messages", 0)
                    nodes.append({
                        "id": c["msisdn"], "msisdn": c["msisdn"],
                        "label": c["msisdn"][-6:], "is_target": False,
                        "weight": total,
                        "call_count": c.get("outgoing_calls", 0) + c.get("incoming_calls", 0),
                    })
                    edges.append({"source": msisdn, "target": c["msisdn"], "weight": total})
                result["graph"] = {"nodes": nodes, "edges": edges}

        # === SEARCH (works with or without MSISDN) ===
        if intent == "search":
            search_text = self._extract_search_query(message, msisdn)
            if search_text:
                search_results = await self._fetch_search(db, search_text, msisdn, dt_from, dt_to)
                if search_results:
                    result["has_data"] = True
                    result["evidence"].append(Evidence(
                        source="Search Results",
                        data=search_results,
                        relevance=0.95,
                    ))
                    msg_count = search_results.get("total_messages", 0)
                    call_count = search_results.get("total_calls", 0)
                    result["summary_parts"].append(
                        f"Search '{search_text}': found {msg_count} messages and {call_count} call transcripts"
                    )
                    # Add matching calls to timeline
                    for c in search_results.get("calls", []):
                        result["timeline"].append({
                            "type": "call",
                            "timestamp": c["timestamp"],
                            "from": c["caller"],
                            "to": c["callee"],
                            "duration": c.get("duration", 0),
                            "description": f"Call transcript: {(c.get('transcript') or '')[:80]}",
                            "preview": c.get("transcript"),
                        })
                    # Add matching messages to timeline
                    for m in search_results.get("messages", []):
                        result["timeline"].append({
                            "type": "sms",
                            "timestamp": m["timestamp"],
                            "from": m["sender"],
                            "to": m["receiver"],
                            "description": f"SMS: {m.get('content', '')}",
                            "preview": m.get("content"),
                        })
                    result["timeline"].sort(key=lambda x: x["timestamp"], reverse=True)

        return result

    # ------------------------------------------------------------------
    # Data fetching helpers
    # ------------------------------------------------------------------

    async def _fetch_entity(self, db: AsyncSession, msisdn: str) -> Optional[dict]:
        stmt = select(PhoneNumber).where(PhoneNumber.msisdn == msisdn)
        res = await db.execute(stmt)
        phone = res.scalar_one_or_none()
        if not phone:
            return None

        entity = {
            "type": "phone",
            "msisdn": phone.msisdn,
            "status": phone.status,
            "carrier": phone.carrier,
            "activation_date": phone.activation_date.isoformat() if phone.activation_date else None,
            "phones": [{"msisdn": phone.msisdn, "status": phone.status, "carrier": phone.carrier}],
            "devices": [],
            "metadata": {},
        }

        if phone.person_id:
            p_stmt = select(Person).options(
                selectinload(Person.phone_numbers), selectinload(Person.devices)
            ).where(Person.id == phone.person_id)
            p_res = await db.execute(p_stmt)
            person = p_res.scalar_one_or_none()
            if person:
                entity["name"] = person.name
                entity["id"] = person.id
                entity["nationality"] = person.nationality
                entity["risk_score"] = person.risk_score
                entity["watchlist"] = person.watchlist_status
                entity["aliases"] = person.aliases or []
                entity["phones"] = [
                    {"msisdn": pn.msisdn, "status": pn.status, "carrier": pn.carrier}
                    for pn in person.phone_numbers
                ]
                entity["devices"] = [
                    {"imei": d.imei, "brand": d.brand, "model": f"{d.brand} {d.model}" if d.brand else d.model}
                    for d in person.devices
                ]
                entity["metadata"] = {
                    "nationality": person.nationality,
                    "risk_score": f"{person.risk_score:.0%}",
                    "watchlist": "Yes" if person.watchlist_status else "No",
                    "date_of_birth": person.date_of_birth.isoformat() if person.date_of_birth else "Unknown",
                }

        # Call/message counts
        call_count = (await db.execute(
            select(func.count()).where(or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn))
        )).scalar() or 0
        msg_count = (await db.execute(
            select(func.count()).where(or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn))
        )).scalar() or 0
        entity["metadata"]["total_calls"] = str(call_count)
        entity["metadata"]["total_messages"] = str(msg_count)

        return entity

    async def _fetch_calls(self, db: AsyncSession, msisdn: str, limit: int = 50,
                           dt_from: Optional[datetime] = None, dt_to: Optional[datetime] = None) -> list:
        stmt = (
            select(CallRecord)
            .where(or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn))
        )
        if dt_from:
            stmt = stmt.where(CallRecord.start_time >= dt_from)
        if dt_to:
            stmt = stmt.where(CallRecord.start_time <= dt_to)
        stmt = stmt.order_by(CallRecord.start_time.desc()).limit(limit)
        res = await db.execute(stmt)
        return list(res.scalars().all())

    async def _fetch_messages(self, db: AsyncSession, msisdn: str, limit: int = 30,
                              dt_from: Optional[datetime] = None, dt_to: Optional[datetime] = None) -> list:
        stmt = (
            select(Message)
            .where(or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn))
        )
        if dt_from:
            stmt = stmt.where(Message.timestamp >= dt_from)
        if dt_to:
            stmt = stmt.where(Message.timestamp <= dt_to)
        stmt = stmt.order_by(Message.timestamp.desc()).limit(limit)
        res = await db.execute(stmt)
        return list(res.scalars().all())

    # ------------------------------------------------------------------
    # Advanced investigation tool helpers
    # ------------------------------------------------------------------

    async def _fetch_pattern_of_life(self, db: AsyncSession, msisdn: str, days: int = 30) -> Optional[dict]:
        """Sleep/work/weekend locations from location data + communication patterns from calls/messages."""
        import math
        cutoff = datetime.utcnow() - timedelta(days=days)
        dow_map = {0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}  # pg dow -> Mon=0

        # === LOCATIONS: sleep/work/weekend towers ===
        loc_stmt = (
            select(
                func.extract("hour", LocationEvent.timestamp).label("hr"),
                func.extract("dow", LocationEvent.timestamp).label("dow"),
                LocationEvent.tower_id,
                func.count().label("cnt"),
            )
            .where(LocationEvent.msisdn == msisdn, LocationEvent.timestamp >= cutoff)
            .group_by("hr", "dow", LocationEvent.tower_id)
        )
        loc_res = await db.execute(loc_stmt)
        loc_rows = loc_res.all()

        night_towers: dict[int, int] = {}
        work_towers: dict[int, int] = {}
        weekend_towers: dict[int, int] = {}

        for r in loc_rows:
            hr = int(r.hr)
            day_idx = dow_map.get(int(r.dow), 0)
            if hr >= 23 or hr < 6:
                night_towers[r.tower_id] = night_towers.get(r.tower_id, 0) + r.cnt
            if 9 <= hr < 18 and day_idx < 5:
                work_towers[r.tower_id] = work_towers.get(r.tower_id, 0) + r.cnt
            if day_idx >= 5:
                weekend_towers[r.tower_id] = weekend_towers.get(r.tower_id, 0) + r.cnt

        async def _tower_info(tower_counts: dict) -> dict:
            if not tower_counts:
                return {"tower_id": None, "confidence": 0}
            top_id = max(tower_counts, key=tower_counts.get)
            total = sum(tower_counts.values())
            t_stmt = select(Tower).where(Tower.id == top_id)
            t_res = await db.execute(t_stmt)
            tower = t_res.scalar_one_or_none()
            return {
                "tower_id": tower.tower_id if tower else str(top_id),
                "latitude": tower.latitude if tower else None,
                "longitude": tower.longitude if tower else None,
                "city": tower.city if tower else None,
                "confidence": round(tower_counts[top_id] / max(total, 1), 2),
            }

        # === COMMUNICATION: hourly/weekly from CALLS + MESSAGES ===
        hourly_calls = [0] * 24
        hourly_msgs = [0] * 24
        weekly_calls = [0] * 7
        weekly_msgs = [0] * 7

        # Calls by hour/day
        call_stmt = (
            select(
                func.extract("hour", CallRecord.start_time).label("hr"),
                func.extract("dow", CallRecord.start_time).label("dow"),
                func.count().label("cnt"),
                func.sum(CallRecord.duration_seconds).label("total_dur"),
            )
            .where(
                or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
                CallRecord.start_time >= cutoff,
            )
            .group_by("hr", "dow")
        )
        call_res = await db.execute(call_stmt)
        total_call_duration = 0
        for r in call_res.all():
            hr = int(r.hr)
            day_idx = dow_map.get(int(r.dow), 0)
            hourly_calls[hr] += r.cnt
            weekly_calls[day_idx] += r.cnt
            total_call_duration += r.total_dur or 0

        # Messages by hour/day
        msg_stmt = (
            select(
                func.extract("hour", Message.timestamp).label("hr"),
                func.extract("dow", Message.timestamp).label("dow"),
                func.count().label("cnt"),
            )
            .where(
                or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn),
                Message.timestamp >= cutoff,
            )
            .group_by("hr", "dow")
        )
        msg_res = await db.execute(msg_stmt)
        for r in msg_res.all():
            hr = int(r.hr)
            day_idx = dow_map.get(int(r.dow), 0)
            hourly_msgs[hr] += r.cnt
            weekly_msgs[day_idx] += r.cnt

        # Combined hourly (for routine score)
        hourly_total = [hourly_calls[i] + hourly_msgs[i] for i in range(24)]
        weekly_total = [weekly_calls[i] + weekly_msgs[i] for i in range(7)]
        total_comms = sum(hourly_total)

        if total_comms == 0 and not loc_rows:
            return None

        # Routine score from communication pattern
        entropy = 0
        if total_comms > 0:
            for h in hourly_total:
                if h > 0:
                    p = h / total_comms
                    entropy -= p * math.log(p)
            max_entropy = math.log(24)
            routine_score = round(1 - (entropy / max_entropy), 2) if max_entropy > 0 else 0
        else:
            routine_score = 0

        # Peak hours
        peak_hour = hourly_total.index(max(hourly_total)) if total_comms > 0 else None
        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        peak_day = day_names[weekly_total.index(max(weekly_total))] if total_comms > 0 else None

        # Top contacts (quick)
        contacts = await GraphAnalyticsService.get_contact_network(db, msisdn)
        top_3 = []
        for c in contacts[:3]:
            total = c.get("outgoing_calls", 0) + c.get("incoming_calls", 0)
            top_3.append({"msisdn": c["msisdn"], "calls": total, "duration_sec": c.get("total_call_duration", 0)})

        return {
            "analysis_days": days,
            "sleep_location": await _tower_info(night_towers),
            "work_location": await _tower_info(work_towers),
            "weekend_location": await _tower_info(weekend_towers),
            "hourly_calls": hourly_calls,
            "hourly_messages": hourly_msgs,
            "hourly_total": hourly_total,
            "weekly_calls": weekly_calls,
            "weekly_messages": weekly_msgs,
            "weekly_total": weekly_total,
            "total_calls": sum(hourly_calls),
            "total_messages": sum(hourly_msgs),
            "total_call_duration_sec": total_call_duration,
            "avg_call_duration_sec": round(total_call_duration / max(sum(hourly_calls), 1)),
            "peak_hour": f"{peak_hour}:00" if peak_hour is not None else None,
            "peak_day": peak_day,
            "top_contacts": top_3,
            "routine_score": routine_score,
        }

    async def _fetch_identity_changes(self, db: AsyncSession, msisdn: str) -> Optional[dict]:
        """Check for SIM/device changes."""
        stmt = select(PhoneNumber).where(PhoneNumber.msisdn == msisdn)
        res = await db.execute(stmt)
        phone = res.scalar_one_or_none()
        if not phone:
            return None

        changes = []
        risk_factors = 0

        # Multiple SIMs
        sim_stmt = select(SIM).where(SIM.phone_number_id == phone.id)
        sim_res = await db.execute(sim_stmt)
        sims = list(sim_res.scalars().all())
        if len(sims) > 1:
            changes.append({
                "type": "multiple_sims",
                "count": len(sims),
                "details": [{"imsi": s.imsi, "iccid": s.iccid, "status": s.status} for s in sims],
            })
            risk_factors += 1

        # Devices via SIMs
        device_ids = {s.device_id for s in sims if s.device_id}
        if len(device_ids) > 1:
            dev_stmt = select(Device).where(Device.id.in_(device_ids))
            dev_res = await db.execute(dev_stmt)
            devices = list(dev_res.scalars().all())
            changes.append({
                "type": "multiple_devices_via_sim",
                "count": len(devices),
                "details": [{"imei": d.imei, "brand": d.brand, "model": d.model} for d in devices],
            })
            risk_factors += 1

        # Devices via person
        if phone.person_id:
            pd_stmt = select(Device).where(Device.person_id == phone.person_id)
            pd_res = await db.execute(pd_stmt)
            person_devices = list(pd_res.scalars().all())
            if len(person_devices) > 1:
                changes.append({
                    "type": "multiple_personal_devices",
                    "count": len(person_devices),
                    "details": [{"imei": d.imei, "brand": d.brand, "model": d.model} for d in person_devices],
                })
                risk_factors += 1

        risk = "HIGH" if risk_factors >= 3 else "MEDIUM" if risk_factors >= 1 else "LOW"
        return {"identity_changes": changes, "risk_assessment": risk}

    async def _fetch_night_activity(self, db: AsyncSession, msisdn: str,
                                     dt_from: Optional[datetime] = None, dt_to: Optional[datetime] = None) -> dict:
        """Calls/messages between 11PM-5AM."""
        hour_filter_call = or_(
            func.extract("hour", CallRecord.start_time) >= 23,
            func.extract("hour", CallRecord.start_time) < 5,
        )
        calls_stmt = select(CallRecord).where(
            or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
            hour_filter_call,
        ).order_by(CallRecord.start_time.desc()).limit(50)
        if dt_from:
            calls_stmt = calls_stmt.where(CallRecord.start_time >= dt_from)
        if dt_to:
            calls_stmt = calls_stmt.where(CallRecord.start_time <= dt_to)
        calls_res = await db.execute(calls_stmt)
        night_calls = []
        for cr in calls_res.scalars().all():
            direction = "outgoing" if cr.caller_msisdn == msisdn else "incoming"
            night_calls.append({
                "direction": direction,
                "other_msisdn": cr.callee_msisdn if direction == "outgoing" else cr.caller_msisdn,
                "timestamp": cr.start_time.isoformat(),
                "duration_seconds": cr.duration_seconds,
            })

        hour_filter_msg = or_(
            func.extract("hour", Message.timestamp) >= 23,
            func.extract("hour", Message.timestamp) < 5,
        )
        msgs_stmt = select(Message).where(
            or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn),
            hour_filter_msg,
        ).order_by(Message.timestamp.desc()).limit(30)
        if dt_from:
            msgs_stmt = msgs_stmt.where(Message.timestamp >= dt_from)
        if dt_to:
            msgs_stmt = msgs_stmt.where(Message.timestamp <= dt_to)
        msgs_res = await db.execute(msgs_stmt)
        night_messages = []
        for m in msgs_res.scalars().all():
            night_messages.append({
                "direction": "sent" if m.sender_msisdn == msisdn else "received",
                "other_msisdn": m.receiver_msisdn if m.sender_msisdn == msisdn else m.sender_msisdn,
                "timestamp": m.timestamp.isoformat(),
            })

        return {
            "total_night_calls": len(night_calls),
            "total_night_messages": len(night_messages),
            "night_calls": night_calls[:20],
            "night_messages": night_messages[:10],
        }

    async def _fetch_top_contacts(self, db: AsyncSession, msisdn: str,
                                   dt_from: Optional[datetime] = None, dt_to: Optional[datetime] = None) -> list[dict]:
        """Top contacts by interaction count."""
        contacts = await GraphAnalyticsService.get_contact_network(db, msisdn, dt_from, dt_to)
        result = []
        for c in contacts[:15]:
            total = c.get("outgoing_calls", 0) + c.get("incoming_calls", 0) + c.get("outgoing_messages", 0) + c.get("incoming_messages", 0)
            result.append({
                "msisdn": c["msisdn"],
                "outgoing_calls": c.get("outgoing_calls", 0),
                "incoming_calls": c.get("incoming_calls", 0),
                "outgoing_messages": c.get("outgoing_messages", 0),
                "incoming_messages": c.get("incoming_messages", 0),
                "total_duration_sec": c.get("total_call_duration", 0),
                "total_interactions": total,
            })
        return result

    async def _fetch_stats(self, db: AsyncSession, msisdn: str, days: int = 30) -> dict:
        """Quick activity stats."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        out_calls = (await db.execute(select(func.count()).where(CallRecord.caller_msisdn == msisdn, CallRecord.start_time >= cutoff))).scalar() or 0
        in_calls = (await db.execute(select(func.count()).where(CallRecord.callee_msisdn == msisdn, CallRecord.start_time >= cutoff))).scalar() or 0
        out_msgs = (await db.execute(select(func.count()).where(Message.sender_msisdn == msisdn, Message.timestamp >= cutoff))).scalar() or 0
        in_msgs = (await db.execute(select(func.count()).where(Message.receiver_msisdn == msisdn, Message.timestamp >= cutoff))).scalar() or 0

        # Unique contacts
        contacts_set = set()
        for stmt in [
            select(CallRecord.callee_msisdn).where(CallRecord.caller_msisdn == msisdn, CallRecord.start_time >= cutoff),
            select(CallRecord.caller_msisdn).where(CallRecord.callee_msisdn == msisdn, CallRecord.start_time >= cutoff),
        ]:
            res = await db.execute(stmt)
            contacts_set.update(r[0] for r in res.all())
        contacts_set.discard(msisdn)

        # Most active hour
        hr_stmt = select(
            func.extract("hour", CallRecord.start_time).label("hr"), func.count().label("cnt")
        ).where(
            or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
            CallRecord.start_time >= cutoff,
        ).group_by("hr").order_by(func.count().desc()).limit(1)
        hr_res = (await db.execute(hr_stmt)).first()

        # Most active day
        dow_names = {0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday"}
        dow_stmt = select(
            func.extract("dow", CallRecord.start_time).label("dow"), func.count().label("cnt")
        ).where(
            or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
            CallRecord.start_time >= cutoff,
        ).group_by("dow").order_by(func.count().desc()).limit(1)
        dow_res = (await db.execute(dow_stmt)).first()

        total_calls = out_calls + in_calls
        return {
            "total_calls": total_calls,
            "outgoing_calls": out_calls,
            "incoming_calls": in_calls,
            "total_messages": out_msgs + in_msgs,
            "outgoing_messages": out_msgs,
            "incoming_messages": in_msgs,
            "unique_contacts": len(contacts_set),
            "most_active_hour": f"{int(hr_res.hr):02d}:00" if hr_res else None,
            "most_active_day": dow_names.get(int(dow_res.dow), "Unknown") if dow_res else None,
        }

    # ------------------------------------------------------------------
    # Search helpers
    # ------------------------------------------------------------------

    def _extract_search_query(self, message: str, msisdn: Optional[str]) -> Optional[str]:
        """Extract the search text from the user's message."""
        msg = message
        # Remove MSISDN from message
        if msisdn:
            msg = msg.replace(msisdn, "").strip()
        # Remove trailing "for" if MSISDN was removed
        msg = re.sub(r'\s+for\s*$', '', msg).strip()

        # Try quoted text first
        quoted = re.search(r'["\']([^"\']+)["\']', msg)
        if quoted:
            return quoted.group(1).strip()

        # Remove trailing context like "in calls", "in messages", "from calls"
        msg = re.sub(r'\s+(?:in|from|across)\s+(?:calls?|messages?|sms|texts?|transcripts?)\s*$', '', msg, flags=re.IGNORECASE).strip()

        # Try quoted text first
        quoted_match = re.search(r'["\']([^"\']+)["\']', msg)
        if quoted_match:
            return quoted_match.group(1).strip()

        # Common patterns (greedy to capture multi-word phrases)
        patterns = [
            r'(?:search|find)\s+(?:messages?\s+|calls?\s+)?(?:containing|with|about|mentioning)\s+(.+)$',
            r'(?:search|find)\s+(?:for\s+)(.+)$',
            r'(?:search|find)\s+(.+)$',
            r'(?:containing|mentions?|mentioning)\s+(.+)$',
            r'(?:messages?|calls?)\s+(?:about|containing|with|mentioning)\s+(.+)$',
        ]
        for pattern in patterns:
            m = re.search(pattern, msg, re.IGNORECASE)
            if m:
                text = m.group(1).strip()
                # Clean trailing prepositions only
                text = re.sub(r'\s+(for|from|to|of)\s*$', '', text, flags=re.IGNORECASE).strip()
                if len(text) >= 2:
                    return text

        # Fallback: remove only command verbs, keep the rest
        for word in ["search", "find"]:
            msg = re.sub(r'\b' + word + r'\b', '', msg, flags=re.IGNORECASE)
        msg = msg.strip()
        return msg if len(msg) >= 2 else None

    async def _fetch_search(self, db: AsyncSession, query: str, msisdn: Optional[str],
                             dt_from: Optional[datetime] = None, dt_to: Optional[datetime] = None) -> dict:
        """Search messages by content AND call transcripts."""
        # Search messages
        msg_stmt = select(Message).where(
            Message.content_preview.ilike(f"%{query}%")
        )
        if msisdn:
            msg_stmt = msg_stmt.where(
                or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn)
            )
        if dt_from:
            msg_stmt = msg_stmt.where(Message.timestamp >= dt_from)
        if dt_to:
            msg_stmt = msg_stmt.where(Message.timestamp <= dt_to)
        msg_stmt = msg_stmt.order_by(Message.timestamp.desc()).limit(50)

        msg_res = await db.execute(msg_stmt)
        messages = []
        for m in msg_res.scalars().all():
            messages.append({
                "sender": m.sender_msisdn,
                "receiver": m.receiver_msisdn,
                "timestamp": m.timestamp.isoformat(),
                "content": m.content_preview,
                "type": m.message_type,
            })

        # Search call transcripts
        call_stmt = select(CallRecord).where(
            CallRecord.transcript.ilike(f"%{query}%")
        )
        if msisdn:
            call_stmt = call_stmt.where(
                or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn)
            )
        if dt_from:
            call_stmt = call_stmt.where(CallRecord.start_time >= dt_from)
        if dt_to:
            call_stmt = call_stmt.where(CallRecord.start_time <= dt_to)
        call_stmt = call_stmt.order_by(CallRecord.start_time.desc()).limit(50)

        call_res = await db.execute(call_stmt)
        calls = []
        for c in call_res.scalars().all():
            calls.append({
                "caller": c.caller_msisdn,
                "callee": c.callee_msisdn,
                "timestamp": c.start_time.isoformat(),
                "duration": c.duration_seconds,
                "transcript": c.transcript,
                "call_type": c.call_type,
            })

        return {
            "query": query,
            "total_messages": len(messages),
            "total_calls": len(calls),
            "messages": messages,
            "calls": calls,
        }

    # ------------------------------------------------------------------
    # Response generation
    # ------------------------------------------------------------------

    async def _generate_response(self, message: str, result: dict, intent: str, msisdn: Optional[str]) -> str:
        if not result["has_data"]:
            if msisdn:
                return (
                    f"No data found for MSISDN {msisdn} in the database. "
                    f"This number may not exist in our records. "
                    f"Try one of the sample numbers from the seed data."
                )
            return (
                "I could not find relevant data for your query. "
                "Please include a phone number (MSISDN) like +919656152900, "
                "or a person name to search for."
            )

        # Build structured facts for LLM context
        summary_parts = result["summary_parts"]
        entity = result.get("entity")

        header = ""
        if entity and entity.get("name"):
            header = f"**{entity['name']}** ({msisdn})\n\n"
        elif msisdn:
            header = f"**Analysis for {msisdn}**\n\n"

        facts = "\n".join(f"- {part}" for part in summary_parts)

        # Add risk/watchlist highlights
        if entity:
            if entity.get("watchlist"):
                facts += "\n- WATCHLIST FLAG - This person is on the watchlist"
            risk = entity.get("risk_score", 0)
            if risk and risk > 0.7:
                facts += f"\n- HIGH RISK - Risk score: {risk:.0%}"

        # Build a SHORT facts string for LLM (keep under 200 chars to avoid timeout)
        short_facts = []
        entity_name = entity.get("name", "Unknown") if entity else "Unknown"
        carrier = entity.get("carrier", "?") if entity else "?"
        for part in summary_parts:
            # Shorten each part
            if "belongs to" in part:
                short_facts.append(f"{entity_name} ({carrier}), active")
            elif "call records" in part.lower():
                short_facts.append(part.split("Found ")[-1] if "Found" in part else part)
            elif "messages" in part.lower() and "search" not in part.lower():
                short_facts.append(part.split("Found ")[-1] if "Found" in part else part)
            elif "contact network" in part.lower():
                short_facts.append(part)
            elif "anomal" in part.lower():
                short_facts.append(part)
            elif "pattern" in part.lower():
                short_facts.append(part)
            else:
                short_facts.append(part[:80])

        facts_str = ". ".join(short_facts[:6])  # Max 6 facts

        prompt = (
            f"Query: {message}\n"
            f"Facts: {facts_str}\n"
            f"Response:"
        )

        try:
            llm_text = await asyncio.wait_for(self._call_ollama(prompt), timeout=20.0)
            if llm_text and len(llm_text) > 30 and "unavailable" not in llm_text.lower() and "error" not in llm_text.lower():
                return header + llm_text.strip()
        except asyncio.TimeoutError:
            logger.warning("LLM timed out, using structured fallback")
        except Exception as e:
            logger.warning("LLM failed: %s, using structured fallback", e)

        # Fallback: structured summary
        return header + "**Findings:**\n" + facts

    def _generate_suggestions(self, intent: str, msisdn: Optional[str], target: Optional[str]) -> list[str]:
        if msisdn:
            base = [
                f"Show contact network for {msisdn}",
                f"Check anomalies for {msisdn}",
                f"Pattern of life for {msisdn}",
                f"Night activity for {msisdn}",
                f"Top contacts for {msisdn}",
                f"Generate report for {msisdn}",
                f"Activity stats for {msisdn}",
                f"Identity changes for {msisdn}",
            ]
            # Show different suggestions based on what they just asked
            if intent == "comprehensive":
                return base[:4]
            elif intent in ("relationship", "top_contacts"):
                return [f"Pattern of life for {msisdn}", f"Night activity for {msisdn}", f"Generate report for {msisdn}", f"Activity stats for {msisdn}"]
            elif intent in ("pattern_of_life", "identity_change"):
                return [f"Night activity for {msisdn}", f"Top contacts for {msisdn}", f"Show contact network for {msisdn}", f"Generate report for {msisdn}"]
            return base[:5]

        return [
            "Show all info about +919656152900",
            "Pattern of life for +919845122940",
            "Night activity for +919679984033",
            "Generate report for +919590122159",
        ]

    async def _call_ollama(self, prompt: str) -> str:
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("response", "")
            except httpx.ConnectError:
                logger.warning("Ollama not reachable at %s", OLLAMA_URL)
                return "LLM service unavailable"
            except Exception as e:
                logger.error("Ollama error: %s", e)
                return "LLM service error"
