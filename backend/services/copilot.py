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

# Keywords for intent classification (fallback when LLM unavailable)
_INTENT_KEYWORDS = {
    "relationship": ["contact", "contacts", "network", "called", "communicated", "common", "who called", "who contacted", "relationship"],
    "location": ["location", "tower", "movement", "trail", "where", "co-location", "colocation", "traveled", "travel"],
    "timeline": ["timeline", "history", "chronolog", "when", "activity", "events"],
    "content": ["message", "sms", "text", "content", "conversation", "topic"],
    "pattern": ["anomal", "unusual", "pattern", "spike", "burst", "suspicious", "impossible"],
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

        # Parse date range
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
        if date_from:
            plan["date_from"] = date_from
        if date_to:
            plan["date_to"] = date_to

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

    def _classify_intent_keywords(self, message: str) -> str:
        msg_lower = message.lower()

        # Check for "all info" / "everything" type queries
        if any(kw in msg_lower for kw in ["all info", "everything", "full", "details", "summary", "investigate"]):
            return "comprehensive"

        for intent, keywords in _INTENT_KEYWORDS.items():
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

        if not msisdn and not person_name:
            # No identifiers found - can't do much
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
                        call_row = {
                            "type": "call",
                            "timestamp": c.start_time.isoformat(),
                            "from": c.caller_msisdn,
                            "to": c.callee_msisdn,
                            "duration": c.duration_seconds,
                            "status": c.status,
                            "call_type": c.call_type,
                            "description": f"{direction.title()} call {'to' if direction == 'outgoing' else 'from'} {other} ({c.duration_seconds}s)",
                        }
                        result["timeline"].append(call_row)
                        call_evidence.append({
                            "direction": direction,
                            "other_party": other,
                            "timestamp": c.start_time.isoformat(),
                            "duration_sec": c.duration_seconds,
                            "status": c.status,
                            "call_type": c.call_type,
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
                    for c in top_contacts[:10]:  # Check top 10 for cross-links
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
                impossible = await AnomalyDetectionService.detect_impossible_travel(db, msisdn)
                all_anomalies = []
                for a in anomalies:
                    all_anomalies.append({
                        "type": a.anomaly_type, "description": a.description,
                        "severity": a.severity, "detected_at": a.detected_at.isoformat(),
                    })
                all_anomalies.extend(impossible)
                if all_anomalies:
                    result["has_data"] = True
                    result["evidence"].append(Evidence(
                        source="Anomaly Detection",
                        data={"total_anomalies": len(all_anomalies), "alerts": all_anomalies},
                        relevance=0.95,
                    ))
                    result["summary_parts"].append(f"Anomalies detected: {len(all_anomalies)}")

            # === CO-LOCATION (if two MSISDNs) ===
            if target_msisdn and intent in ("comprehensive", "location"):
                colocations = await GeoAnalyticsService.find_colocation(db, msisdn, target_msisdn, 30)
                if colocations:
                    result["has_data"] = True
                    result["evidence"].append(Evidence(
                        source="co-location",
                        data={"colocation_events": len(colocations), "msisdn1": msisdn, "msisdn2": target_msisdn},
                        relevance=0.9,
                    ))
                    result["summary_parts"].append(f"Co-location: {len(colocations)} events with {target_msisdn}")

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

        # Ask LLM to provide analyst-grade summary (with 15s timeout)
        prompt = (
            f"You are a telecom intelligence analyst. A user asked: \"{message}\"\n\n"
            f"Here are the facts from the database:\n{facts}\n\n"
            f"Write a brief analyst summary (3-5 sentences). Be professional, factual. "
            f"Highlight anything suspicious or noteworthy. Reference specific numbers."
        )

        try:
            llm_text = await asyncio.wait_for(self._call_ollama(prompt), timeout=15.0)
            if llm_text and len(llm_text) > 30 and "unavailable" not in llm_text.lower():
                return header + llm_text.strip()
        except asyncio.TimeoutError:
            logger.warning("LLM timed out after 15s, using structured fallback")
        except Exception as e:
            logger.warning("LLM failed: %s, using structured fallback", e)

        # Fallback: structured summary
        return header + "**Findings:**\n" + facts

    def _generate_suggestions(self, intent: str, msisdn: Optional[str], target: Optional[str]) -> list[str]:
        if msisdn:
            suggestions = [
                f"Show contact network for {msisdn}",
                f"Show movement trail for {msisdn}",
                f"Check anomalies for {msisdn}",
                f"Show call timeline for {msisdn}",
            ]
            if not target:
                suggestions.append(f"Show messages for {msisdn}")
            return suggestions

        return [
            "Show all info about +919656152900",
            "Who contacted +919590122159 recently?",
            "Check anomalies for +919845122940",
            "Show movement trail for +919679984033",
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
