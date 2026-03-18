"""Advanced investigation analytics endpoints for TIAC.

Provides tower dump, geofence, pattern-of-life, identity change detection,
common number analysis, call chain analysis, night activity, top contacts
with heatmap, comprehensive report generation, and activity summary stats.
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, func, and_, or_, case as sql_case, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import DB, CurrentUser
from models.database import (
    CallRecord,
    Device,
    LocationEvent,
    Message,
    Person,
    PhoneNumber,
    SIM,
    Tower,
)
from schemas.advanced import CommonNumbersRequest, GeofenceRequest, ReportRequest
from services.graph_analytics import GraphAnalyticsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/advanced", tags=["advanced-analytics"])


# ---------------------------------------------------------------------------
# Helper: get contacts for an MSISDN (calls + messages)
# ---------------------------------------------------------------------------

async def _get_contacts_for_msisdn(
    db: AsyncSession,
    msisdn: str,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
) -> dict[str, dict]:
    """Return a dict of contact_msisdn -> {call_count, msg_count, total_duration}."""

    call_time_filters = []
    if from_date:
        call_time_filters.append(CallRecord.start_time >= from_date)
    if to_date:
        call_time_filters.append(CallRecord.start_time <= to_date)

    msg_time_filters = []
    if from_date:
        msg_time_filters.append(Message.timestamp >= from_date)
    if to_date:
        msg_time_filters.append(Message.timestamp <= to_date)

    # Outgoing calls
    out_calls = (
        select(
            CallRecord.callee_msisdn.label("contact"),
            func.count().label("cnt"),
            func.coalesce(func.sum(CallRecord.duration_seconds), 0).label("dur"),
        )
        .where(CallRecord.caller_msisdn == msisdn, *call_time_filters)
        .group_by(CallRecord.callee_msisdn)
    )
    # Incoming calls
    in_calls = (
        select(
            CallRecord.caller_msisdn.label("contact"),
            func.count().label("cnt"),
            func.coalesce(func.sum(CallRecord.duration_seconds), 0).label("dur"),
        )
        .where(CallRecord.callee_msisdn == msisdn, *call_time_filters)
        .group_by(CallRecord.caller_msisdn)
    )
    # Outgoing messages
    out_msgs = (
        select(
            Message.receiver_msisdn.label("contact"),
            func.count().label("cnt"),
        )
        .where(Message.sender_msisdn == msisdn, *msg_time_filters)
        .group_by(Message.receiver_msisdn)
    )
    # Incoming messages
    in_msgs = (
        select(
            Message.sender_msisdn.label("contact"),
            func.count().label("cnt"),
        )
        .where(Message.receiver_msisdn == msisdn, *msg_time_filters)
        .group_by(Message.sender_msisdn)
    )

    contacts: dict[str, dict] = {}

    for row in (await db.execute(out_calls)).all():
        c = contacts.setdefault(row.contact, {"call_count": 0, "msg_count": 0, "total_duration": 0})
        c["call_count"] += row.cnt
        c["total_duration"] += row.dur
    for row in (await db.execute(in_calls)).all():
        c = contacts.setdefault(row.contact, {"call_count": 0, "msg_count": 0, "total_duration": 0})
        c["call_count"] += row.cnt
        c["total_duration"] += row.dur
    for row in (await db.execute(out_msgs)).all():
        c = contacts.setdefault(row.contact, {"call_count": 0, "msg_count": 0, "total_duration": 0})
        c["msg_count"] += row.cnt
    for row in (await db.execute(in_msgs)).all():
        c = contacts.setdefault(row.contact, {"call_count": 0, "msg_count": 0, "total_duration": 0})
        c["msg_count"] += row.cnt

    contacts.pop(msisdn, None)
    return contacts


# ---------------------------------------------------------------------------
# 0. Full-Text Search
# ---------------------------------------------------------------------------


@router.get("/search")
async def search_records(
    db: DB,
    user: CurrentUser,
    q: str = Query(..., min_length=2, description="Search text"),
    search_type: str = Query("all", description="all, messages, calls, persons"),
    msisdn: Optional[str] = Query(None, description="Filter by MSISDN"),
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(50, le=200),
):
    """Search across messages, calls, and persons."""
    results: dict = {}

    # --- Messages ---
    if search_type in ("all", "messages"):
        msg_stmt = (
            select(Message)
            .where(Message.content_preview.ilike(f"%{q}%"))
        )
        if msisdn:
            msg_stmt = msg_stmt.where(
                or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn)
            )
        if from_date:
            msg_stmt = msg_stmt.where(Message.timestamp >= from_date)
        if to_date:
            msg_stmt = msg_stmt.where(Message.timestamp <= to_date)
        msg_stmt = msg_stmt.order_by(Message.timestamp.desc()).limit(limit)
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
        results["messages"] = messages
        results["total_messages"] = len(messages)

    # --- Calls (search by MSISDN or transcript content) ---
    if search_type in ("all", "calls"):
        calls: list[dict] = []
        q_stripped = q.replace("+", "").replace(" ", "")
        # Build call search: by MSISDN if numeric, OR by transcript content
        call_conditions = []
        if q_stripped.isdigit():
            call_conditions.append(or_(
                CallRecord.caller_msisdn.ilike(f"%{q}%"),
                CallRecord.callee_msisdn.ilike(f"%{q}%"),
            ))
        # Always search transcript text
        call_conditions.append(CallRecord.transcript.ilike(f"%{q}%"))

        if call_conditions:
            call_stmt = select(CallRecord).where(or_(*call_conditions))
            if msisdn:
                call_stmt = call_stmt.where(
                    or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn)
                )
            if from_date:
                call_stmt = call_stmt.where(CallRecord.start_time >= from_date)
            if to_date:
                call_stmt = call_stmt.where(CallRecord.start_time <= to_date)
            call_stmt = call_stmt.order_by(CallRecord.start_time.desc()).limit(limit)
            call_res = await db.execute(call_stmt)
            for c in call_res.scalars().all():
                calls.append({
                    "caller": c.caller_msisdn,
                    "callee": c.callee_msisdn,
                    "start_time": c.start_time.isoformat(),
                    "duration": c.duration_seconds,
                    "status": c.status,
                    "call_type": c.call_type,
                    "transcript": c.transcript,
                })
        results["calls"] = calls
        results["total_calls"] = len(calls)

    # --- Persons ---
    if search_type in ("all", "persons"):
        person_stmt = (
            select(Person)
            .where(Person.name.ilike(f"%{q}%"))
            .limit(limit)
        )
        person_res = await db.execute(person_stmt)
        persons = []
        for p in person_res.scalars().all():
            persons.append({
                "id": p.id,
                "name": p.name,
                "nationality": p.nationality,
                "risk_score": p.risk_score,
                "watchlist_status": p.watchlist_status,
            })
        results["persons"] = persons
        results["total_persons"] = len(persons)

    return {
        "query": q,
        "search_type": search_type,
        "results": results,
    }


# ---------------------------------------------------------------------------
# 1. Tower Dump Analysis
# ---------------------------------------------------------------------------

@router.get("/tower-dump/{tower_id}")
async def tower_dump(
    tower_id: str,
    db: DB,
    user: CurrentUser,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(500, le=5000),
):
    """Find ALL MSISDNs that connected to a specific tower during a time range.

    tower_id is the human-readable tower identifier (e.g. MUM-COL-000-01).
    """
    # Resolve tower by its string tower_id
    tower_stmt = select(Tower).where(Tower.tower_id == tower_id)
    tower_result = await db.execute(tower_stmt)
    tower = tower_result.scalar_one_or_none()
    if not tower:
        raise HTTPException(status_code=404, detail=f"Tower '{tower_id}' not found")

    stmt = (
        select(
            LocationEvent.msisdn,
            func.count().label("event_count"),
            func.min(LocationEvent.timestamp).label("first_seen"),
            func.max(LocationEvent.timestamp).label("last_seen"),
            func.avg(LocationEvent.signal_strength).label("avg_signal_strength"),
        )
        .where(LocationEvent.tower_id == tower.id)
    )
    if from_date:
        stmt = stmt.where(LocationEvent.timestamp >= from_date)
    if to_date:
        stmt = stmt.where(LocationEvent.timestamp <= to_date)

    stmt = (
        stmt.group_by(LocationEvent.msisdn)
        .order_by(func.count().desc())
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    # For each MSISDN, also fetch distinct event types
    results = []
    for row in rows:
        event_types_stmt = (
            select(distinct(LocationEvent.event_type))
            .where(
                LocationEvent.tower_id == tower.id,
                LocationEvent.msisdn == row.msisdn,
            )
        )
        if from_date:
            event_types_stmt = event_types_stmt.where(LocationEvent.timestamp >= from_date)
        if to_date:
            event_types_stmt = event_types_stmt.where(LocationEvent.timestamp <= to_date)

        et_result = await db.execute(event_types_stmt)
        event_types = [r[0] for r in et_result.all()]

        dwell_minutes = 0
        if row.first_seen and row.last_seen:
            dwell_minutes = round((row.last_seen - row.first_seen).total_seconds() / 60, 1)

        results.append({
            "msisdn": row.msisdn,
            "event_count": row.event_count,
            "first_seen": row.first_seen.isoformat() if row.first_seen else None,
            "last_seen": row.last_seen.isoformat() if row.last_seen else None,
            "dwell_minutes": dwell_minutes,
            "event_types": event_types,
            "avg_signal_strength": round(row.avg_signal_strength, 2) if row.avg_signal_strength else None,
        })

    return {
        "tower_id": tower.tower_id,
        "tower_db_id": tower.id,
        "tower_location": {"latitude": tower.latitude, "longitude": tower.longitude, "city": tower.city},
        "time_range": {
            "from": from_date.isoformat() if from_date else None,
            "to": to_date.isoformat() if to_date else None,
        },
        "total_unique_msisdns": len(results),
        "results": results,
    }


# ---------------------------------------------------------------------------
# 2. Geofence Analysis
# ---------------------------------------------------------------------------

@router.post("/geofence")
async def geofence_analysis(
    body: GeofenceRequest,
    db: DB,
    user: CurrentUser,
):
    """Find all MSISDNs that appeared within a geographic bounding box during a time range.

    Joins LocationEvent with Tower, filtering by tower coordinates within bounds.
    """
    stmt = (
        select(
            LocationEvent.msisdn,
            func.count().label("event_count"),
            func.min(LocationEvent.timestamp).label("first_seen"),
            func.max(LocationEvent.timestamp).label("last_seen"),
        )
        .join(Tower, LocationEvent.tower_id == Tower.id)
        .where(
            Tower.latitude >= body.lat_min,
            Tower.latitude <= body.lat_max,
            Tower.longitude >= body.lng_min,
            Tower.longitude <= body.lng_max,
        )
    )
    if body.date_from:
        stmt = stmt.where(LocationEvent.timestamp >= body.date_from)
    if body.date_to:
        stmt = stmt.where(LocationEvent.timestamp <= body.date_to)

    stmt = stmt.group_by(LocationEvent.msisdn).order_by(func.count().desc())

    result = await db.execute(stmt)
    rows = result.all()

    # For each MSISDN, fetch the distinct towers used within bounds
    results = []
    for row in rows:
        towers_stmt = (
            select(distinct(Tower.tower_id))
            .join(LocationEvent, LocationEvent.tower_id == Tower.id)
            .where(
                LocationEvent.msisdn == row.msisdn,
                Tower.latitude >= body.lat_min,
                Tower.latitude <= body.lat_max,
                Tower.longitude >= body.lng_min,
                Tower.longitude <= body.lng_max,
            )
        )
        if body.date_from:
            towers_stmt = towers_stmt.where(LocationEvent.timestamp >= body.date_from)
        if body.date_to:
            towers_stmt = towers_stmt.where(LocationEvent.timestamp <= body.date_to)

        t_result = await db.execute(towers_stmt)
        towers_used = [r[0] for r in t_result.all()]

        results.append({
            "msisdn": row.msisdn,
            "event_count": row.event_count,
            "first_seen": row.first_seen.isoformat() if row.first_seen else None,
            "last_seen": row.last_seen.isoformat() if row.last_seen else None,
            "towers_used": towers_used,
        })

    return {
        "bounds": {
            "lat_min": body.lat_min,
            "lat_max": body.lat_max,
            "lng_min": body.lng_min,
            "lng_max": body.lng_max,
        },
        "time_range": {
            "from": body.date_from.isoformat() if body.date_from else None,
            "to": body.date_to.isoformat() if body.date_to else None,
        },
        "total_unique_msisdns": len(results),
        "results": results,
    }


# ---------------------------------------------------------------------------
# 3. Pattern of Life
# ---------------------------------------------------------------------------

@router.get("/pattern-of-life/{msisdn}")
async def pattern_of_life(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    days: int = Query(30, ge=1, le=365),
):
    """Analyze daily routine patterns for an MSISDN.

    Identifies sleep location, work location, hourly/weekly activity distribution,
    regular routes, and a routine predictability score.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)

    # All location events in period
    base_filter = and_(
        LocationEvent.msisdn == msisdn,
        LocationEvent.timestamp >= cutoff,
        LocationEvent.tower_id.isnot(None),
    )

    # --- Sleep location: most frequent tower 11PM-6AM ---
    sleep_stmt = (
        select(
            LocationEvent.tower_id,
            func.count().label("cnt"),
        )
        .where(
            base_filter,
            or_(
                func.extract("hour", LocationEvent.timestamp) >= 23,
                func.extract("hour", LocationEvent.timestamp) < 6,
            ),
        )
        .group_by(LocationEvent.tower_id)
        .order_by(func.count().desc())
        .limit(1)
    )
    sleep_result = await db.execute(sleep_stmt)
    sleep_row = sleep_result.first()

    sleep_location = None
    if sleep_row:
        tower = (await db.execute(select(Tower).where(Tower.id == sleep_row.tower_id))).scalar_one_or_none()
        # Calculate confidence: fraction of night events at this tower
        total_night_stmt = (
            select(func.count())
            .where(
                base_filter,
                or_(
                    func.extract("hour", LocationEvent.timestamp) >= 23,
                    func.extract("hour", LocationEvent.timestamp) < 6,
                ),
            )
        )
        total_night = (await db.execute(total_night_stmt)).scalar() or 1
        confidence = round(sleep_row.cnt / total_night, 2)
        if tower:
            sleep_location = {
                "tower_id": tower.tower_id,
                "latitude": tower.latitude,
                "longitude": tower.longitude,
                "city": tower.city,
                "confidence": confidence,
            }

    # --- Work location: most frequent tower 9AM-6PM on weekdays (dow 1-5) ---
    work_stmt = (
        select(
            LocationEvent.tower_id,
            func.count().label("cnt"),
        )
        .where(
            base_filter,
            func.extract("hour", LocationEvent.timestamp) >= 9,
            func.extract("hour", LocationEvent.timestamp) < 18,
            func.extract("dow", LocationEvent.timestamp).in_([1, 2, 3, 4, 5]),
        )
        .group_by(LocationEvent.tower_id)
        .order_by(func.count().desc())
        .limit(1)
    )
    work_result = await db.execute(work_stmt)
    work_row = work_result.first()

    work_location = None
    if work_row:
        tower = (await db.execute(select(Tower).where(Tower.id == work_row.tower_id))).scalar_one_or_none()
        total_work_stmt = (
            select(func.count())
            .where(
                base_filter,
                func.extract("hour", LocationEvent.timestamp) >= 9,
                func.extract("hour", LocationEvent.timestamp) < 18,
                func.extract("dow", LocationEvent.timestamp).in_([1, 2, 3, 4, 5]),
            )
        )
        total_work = (await db.execute(total_work_stmt)).scalar() or 1
        confidence = round(work_row.cnt / total_work, 2)
        if tower:
            work_location = {
                "tower_id": tower.tower_id,
                "latitude": tower.latitude,
                "longitude": tower.longitude,
                "city": tower.city,
                "confidence": confidence,
            }

    # --- Weekend location: most frequent tower on weekends (dow 0, 6) ---
    weekend_stmt = (
        select(
            LocationEvent.tower_id,
            func.count().label("cnt"),
        )
        .where(
            base_filter,
            func.extract("dow", LocationEvent.timestamp).in_([0, 6]),
        )
        .group_by(LocationEvent.tower_id)
        .order_by(func.count().desc())
        .limit(1)
    )
    weekend_result = await db.execute(weekend_stmt)
    weekend_row = weekend_result.first()

    weekend_location = None
    if weekend_row:
        tower = (await db.execute(select(Tower).where(Tower.id == weekend_row.tower_id))).scalar_one_or_none()
        if tower:
            total_weekend_stmt = (
                select(func.count())
                .where(
                    base_filter,
                    func.extract("dow", LocationEvent.timestamp).in_([0, 6]),
                )
            )
            total_weekend = (await db.execute(total_weekend_stmt)).scalar() or 1
            weekend_location = {
                "tower_id": tower.tower_id,
                "latitude": tower.latitude,
                "longitude": tower.longitude,
                "city": tower.city,
                "confidence": round(weekend_row.cnt / total_weekend, 2),
            }

    # --- Hourly activity histogram (24 slots) ---
    hourly_stmt = (
        select(
            func.extract("hour", LocationEvent.timestamp).label("hr"),
            func.count().label("cnt"),
        )
        .where(base_filter)
        .group_by(func.extract("hour", LocationEvent.timestamp))
    )
    hourly_result = await db.execute(hourly_stmt)
    hourly_map = {int(r.hr): r.cnt for r in hourly_result.all()}
    hourly_activity = [hourly_map.get(h, 0) for h in range(24)]

    # --- Weekly activity (7 slots: Mon=0 .. Sun=6) ---
    # PostgreSQL dow: 0=Sunday, 1=Monday ... 6=Saturday
    # We remap to Mon=0 .. Sun=6
    weekly_stmt = (
        select(
            func.extract("dow", LocationEvent.timestamp).label("dow"),
            func.count().label("cnt"),
        )
        .where(base_filter)
        .group_by(func.extract("dow", LocationEvent.timestamp))
    )
    weekly_result = await db.execute(weekly_stmt)
    pg_dow_map = {int(r.dow): r.cnt for r in weekly_result.all()}
    # Remap: pg dow 0=Sun->index 6, 1=Mon->0, 2=Tue->1, ... 6=Sat->5
    weekly_activity = [
        pg_dow_map.get(1, 0),  # Mon
        pg_dow_map.get(2, 0),  # Tue
        pg_dow_map.get(3, 0),  # Wed
        pg_dow_map.get(4, 0),  # Thu
        pg_dow_map.get(5, 0),  # Fri
        pg_dow_map.get(6, 0),  # Sat
        pg_dow_map.get(0, 0),  # Sun
    ]

    # --- Regular routes: top 5 tower-to-tower transitions ---
    transitions_stmt = (
        select(LocationEvent)
        .where(base_filter)
        .order_by(LocationEvent.timestamp)
    )
    transitions_result = await db.execute(transitions_stmt)
    events = transitions_result.scalars().all()

    route_counts: dict[tuple[int, int], dict] = {}
    for i in range(1, len(events)):
        prev_tid = events[i - 1].tower_id
        curr_tid = events[i].tower_id
        if prev_tid and curr_tid and prev_tid != curr_tid:
            key = (prev_tid, curr_tid)
            if key not in route_counts:
                route_counts[key] = {"frequency": 0, "times": []}
            route_counts[key]["frequency"] += 1
            route_counts[key]["times"].append(events[i].timestamp)

    # Sort by frequency and take top 5
    top_routes_raw = sorted(route_counts.items(), key=lambda x: x[1]["frequency"], reverse=True)[:5]
    regular_routes = []
    for (from_tid, to_tid), info in top_routes_raw:
        from_tower = (await db.execute(select(Tower).where(Tower.id == from_tid))).scalar_one_or_none()
        to_tower = (await db.execute(select(Tower).where(Tower.id == to_tid))).scalar_one_or_none()
        # Calculate typical time as average hour:minute
        if info["times"]:
            avg_minutes = sum(t.hour * 60 + t.minute for t in info["times"]) / len(info["times"])
            typical_hour = int(avg_minutes // 60)
            typical_minute = int(avg_minutes % 60)
            typical_time = f"{typical_hour:02d}:{typical_minute:02d}"
        else:
            typical_time = None

        regular_routes.append({
            "from_tower": from_tower.tower_id if from_tower else str(from_tid),
            "to_tower": to_tower.tower_id if to_tower else str(to_tid),
            "frequency": info["frequency"],
            "typical_time": typical_time,
        })

    # --- Routine score: entropy-based predictability ---
    # Lower entropy = more predictable = higher routine score
    total_events = sum(hourly_activity) or 1
    hour_probs = [c / total_events for c in hourly_activity if c > 0]
    import math
    max_entropy = math.log(24)  # max entropy if uniformly distributed
    entropy = -sum(p * math.log(p) for p in hour_probs) if hour_probs else max_entropy
    routine_score = round(max(0.0, 1.0 - (entropy / max_entropy)), 2)

    return {
        "msisdn": msisdn,
        "analysis_days": days,
        "sleep_location": sleep_location,
        "work_location": work_location,
        "weekend_location": weekend_location,
        "hourly_activity": hourly_activity,
        "weekly_activity": weekly_activity,
        "regular_routes": regular_routes,
        "routine_score": routine_score,
    }


# ---------------------------------------------------------------------------
# 4. IMEI/SIM Change Detection
# ---------------------------------------------------------------------------

@router.get("/identity-changes/{msisdn}")
async def identity_changes(
    msisdn: str,
    db: DB,
    user: CurrentUser,
):
    """Check if an MSISDN has been associated with different devices or SIMs.

    Examines PhoneNumber -> SIM -> Device chains to detect multiple SIMs
    for the same number, multiple devices for the same person, and SIM
    status changes.
    """
    # Find PhoneNumber record
    pn_stmt = select(PhoneNumber).where(PhoneNumber.msisdn == msisdn)
    pn_result = await db.execute(pn_stmt)
    phone_number = pn_result.scalar_one_or_none()

    if not phone_number:
        raise HTTPException(status_code=404, detail=f"Phone number '{msisdn}' not found")

    identity_items = []
    risk_factors = 0

    # --- Multiple SIMs for same phone number ---
    sims_stmt = select(SIM).where(SIM.phone_number_id == phone_number.id)
    sims_result = await db.execute(sims_stmt)
    sims = sims_result.scalars().all()

    if len(sims) > 1:
        risk_factors += 1
    sim_details = []
    device_ids_from_sims = set()
    for sim in sims:
        sim_details.append({
            "imsi": sim.imsi,
            "iccid": sim.iccid,
            "status": sim.status,
            "device_id": sim.device_id,
            "created_at": sim.created_at.isoformat() if sim.created_at else None,
        })
        if sim.device_id:
            device_ids_from_sims.add(sim.device_id)

    identity_items.append({
        "type": "multiple_sims",
        "count": len(sims),
        "sims": sim_details,
    })

    # --- Multiple devices linked via SIMs ---
    devices_via_sims = []
    if device_ids_from_sims:
        devices_stmt = select(Device).where(Device.id.in_(device_ids_from_sims))
        devices_result = await db.execute(devices_stmt)
        devices = devices_result.scalars().all()
        if len(devices) > 1:
            risk_factors += 1
        for dev in devices:
            devices_via_sims.append({
                "imei": dev.imei,
                "brand": dev.brand,
                "model": dev.model,
                "created_at": dev.created_at.isoformat() if dev.created_at else None,
            })

    # --- Multiple devices for same person ---
    person_devices = []
    if phone_number.person_id:
        person_devices_stmt = select(Device).where(Device.person_id == phone_number.person_id)
        person_devices_result = await db.execute(person_devices_stmt)
        person_devices = person_devices_result.scalars().all()
        if len(person_devices) > 1:
            risk_factors += 1

    identity_items.append({
        "type": "multiple_devices",
        "count": len(devices_via_sims) or len(person_devices),
        "devices_via_sims": devices_via_sims,
        "devices_via_person": [
            {
                "imei": d.imei,
                "brand": d.brand,
                "model": d.model,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in person_devices
        ],
    })

    # --- SIM status changes ---
    status_set = {s.status for s in sims}
    if "suspended" in status_set or "inactive" in status_set:
        risk_factors += 1
    identity_items.append({
        "type": "sim_statuses",
        "statuses": list(status_set),
    })

    # Risk assessment
    if risk_factors >= 3:
        risk = "HIGH"
    elif risk_factors >= 1:
        risk = "MEDIUM"
    else:
        risk = "LOW"

    return {
        "msisdn": msisdn,
        "person_id": phone_number.person_id,
        "identity_changes": identity_items,
        "risk_assessment": risk,
    }


# ---------------------------------------------------------------------------
# 5. Common Number Analysis
# ---------------------------------------------------------------------------

@router.post("/common-numbers")
async def common_numbers(
    body: CommonNumbersRequest,
    db: DB,
    user: CurrentUser,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """Find numbers that ALL (or any two) of the provided MSISDNs have communicated with.

    Returns contacts common to all input MSISDNs and contacts common to any pair.
    """
    input_msisdns = body.msisdns
    per_msisdn_contacts: dict[str, dict[str, dict]] = {}

    for msisdn in input_msisdns:
        per_msisdn_contacts[msisdn] = await _get_contacts_for_msisdn(db, msisdn, from_date, to_date)

    # Compute intersection across all
    all_contact_sets = [set(c.keys()) for c in per_msisdn_contacts.values()]
    common_to_all_set = all_contact_sets[0]
    for s in all_contact_sets[1:]:
        common_to_all_set &= s
    # Remove input msisdns from results
    common_to_all_set -= set(input_msisdns)

    common_to_all = []
    for contact in sorted(common_to_all_set):
        call_counts = []
        for msisdn in input_msisdns:
            info = per_msisdn_contacts[msisdn].get(contact, {})
            call_counts.append(info.get("call_count", 0) + info.get("msg_count", 0))
        common_to_all.append({
            "msisdn": contact,
            "interaction_count_per_input": call_counts,
        })

    # Common to any two
    common_to_any_two_set: set[str] = set()
    for i in range(len(all_contact_sets)):
        for j in range(i + 1, len(all_contact_sets)):
            common_to_any_two_set |= (all_contact_sets[i] & all_contact_sets[j])
    common_to_any_two_set -= common_to_all_set
    common_to_any_two_set -= set(input_msisdns)

    common_to_any_two = []
    for contact in sorted(common_to_any_two_set):
        shared_with = []
        for msisdn in input_msisdns:
            if contact in per_msisdn_contacts[msisdn]:
                shared_with.append(msisdn)
        common_to_any_two.append({
            "msisdn": contact,
            "shared_with": shared_with,
        })

    return {
        "input_msisdns": input_msisdns,
        "common_to_all": common_to_all,
        "common_to_all_count": len(common_to_all),
        "common_to_any_two": common_to_any_two,
        "common_to_any_two_count": len(common_to_any_two),
    }


# ---------------------------------------------------------------------------
# 6. Call Chain Analysis (enhanced shortest path)
# ---------------------------------------------------------------------------

@router.get("/call-chain")
async def call_chain(
    db: DB,
    user: CurrentUser,
    source: str = Query(...),
    target: str = Query(...),
    max_hops: int = Query(4, le=6),
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """Find shortest contact chain between two MSISDNs with per-hop details.

    Enhances the basic shortest-path with call count, total duration, and
    last call time for each hop in the chain.
    """
    path = await GraphAnalyticsService.find_shortest_path(db, source, target, max_hops)

    if path is None:
        return {
            "source": source,
            "target": target,
            "found": False,
            "path": None,
            "hops": None,
            "hop_details": None,
        }

    # Enrich each hop with call/message details
    hop_details = []
    call_time_filters = []
    if from_date:
        call_time_filters.append(CallRecord.start_time >= from_date)
    if to_date:
        call_time_filters.append(CallRecord.start_time <= to_date)

    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]

        # Calls in both directions between a and b
        calls_stmt = (
            select(
                func.count().label("call_count"),
                func.coalesce(func.sum(CallRecord.duration_seconds), 0).label("total_duration"),
                func.max(CallRecord.start_time).label("last_call"),
            )
            .where(
                or_(
                    and_(CallRecord.caller_msisdn == a, CallRecord.callee_msisdn == b),
                    and_(CallRecord.caller_msisdn == b, CallRecord.callee_msisdn == a),
                ),
                *call_time_filters,
            )
        )
        calls_row = (await db.execute(calls_stmt)).first()

        # Messages in both directions
        msg_filters = []
        if from_date:
            msg_filters.append(Message.timestamp >= from_date)
        if to_date:
            msg_filters.append(Message.timestamp <= to_date)

        msgs_stmt = (
            select(func.count().label("msg_count"))
            .where(
                or_(
                    and_(Message.sender_msisdn == a, Message.receiver_msisdn == b),
                    and_(Message.sender_msisdn == b, Message.receiver_msisdn == a),
                ),
                *msg_filters,
            )
        )
        msgs_row = (await db.execute(msgs_stmt)).first()

        hop_details.append({
            "from": a,
            "to": b,
            "call_count": calls_row.call_count if calls_row else 0,
            "total_duration_seconds": calls_row.total_duration if calls_row else 0,
            "last_call_time": calls_row.last_call.isoformat() if calls_row and calls_row.last_call else None,
            "message_count": msgs_row.msg_count if msgs_row else 0,
        })

    return {
        "source": source,
        "target": target,
        "found": True,
        "path": path,
        "hops": len(path) - 1,
        "hop_details": hop_details,
    }


# ---------------------------------------------------------------------------
# 7. Night Activity Detection
# ---------------------------------------------------------------------------

@router.get("/night-activity/{msisdn}")
async def night_activity(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    night_start: int = Query(23, ge=0, le=23, description="Hour when night starts (24h format)"),
    night_end: int = Query(5, ge=0, le=23, description="Hour when night ends (24h format)"),
):
    """Find all calls and messages made during night hours for an MSISDN."""

    # Build hour filter: night_start..23 OR 0..night_end
    if night_start > night_end:
        hour_filter_call = or_(
            func.extract("hour", CallRecord.start_time) >= night_start,
            func.extract("hour", CallRecord.start_time) < night_end,
        )
        hour_filter_msg = or_(
            func.extract("hour", Message.timestamp) >= night_start,
            func.extract("hour", Message.timestamp) < night_end,
        )
    else:
        hour_filter_call = and_(
            func.extract("hour", CallRecord.start_time) >= night_start,
            func.extract("hour", CallRecord.start_time) < night_end,
        )
        hour_filter_msg = and_(
            func.extract("hour", Message.timestamp) >= night_start,
            func.extract("hour", Message.timestamp) < night_end,
        )

    # Night calls
    calls_stmt = (
        select(CallRecord)
        .where(
            or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
            hour_filter_call,
        )
        .order_by(CallRecord.start_time.desc())
    )
    if from_date:
        calls_stmt = calls_stmt.where(CallRecord.start_time >= from_date)
    if to_date:
        calls_stmt = calls_stmt.where(CallRecord.start_time <= to_date)

    calls_result = await db.execute(calls_stmt)
    night_calls = []
    for cr in calls_result.scalars().all():
        direction = "outgoing" if cr.caller_msisdn == msisdn else "incoming"
        other = cr.callee_msisdn if direction == "outgoing" else cr.caller_msisdn
        night_calls.append({
            "type": "call",
            "direction": direction,
            "other_msisdn": other,
            "start_time": cr.start_time.isoformat(),
            "duration_seconds": cr.duration_seconds,
            "status": cr.status,
        })

    # Night messages
    msgs_stmt = (
        select(Message)
        .where(
            or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn),
            hour_filter_msg,
        )
        .order_by(Message.timestamp.desc())
    )
    if from_date:
        msgs_stmt = msgs_stmt.where(Message.timestamp >= from_date)
    if to_date:
        msgs_stmt = msgs_stmt.where(Message.timestamp <= to_date)

    msgs_result = await db.execute(msgs_stmt)
    night_messages = []
    for msg in msgs_result.scalars().all():
        direction = "outgoing" if msg.sender_msisdn == msisdn else "incoming"
        other = msg.receiver_msisdn if direction == "outgoing" else msg.sender_msisdn
        night_messages.append({
            "type": "message",
            "direction": direction,
            "other_msisdn": other,
            "timestamp": msg.timestamp.isoformat(),
            "message_type": msg.message_type,
        })

    # Unique contacts during night hours
    night_contacts = set()
    for c in night_calls:
        night_contacts.add(c["other_msisdn"])
    for m in night_messages:
        night_contacts.add(m["other_msisdn"])

    return {
        "msisdn": msisdn,
        "night_hours": f"{night_start:02d}:00 - {night_end:02d}:00",
        "total_night_calls": len(night_calls),
        "total_night_messages": len(night_messages),
        "unique_night_contacts": len(night_contacts),
        "night_calls": night_calls,
        "night_messages": night_messages,
    }


# ---------------------------------------------------------------------------
# 8. Frequently Contacted (Top-N with heatmap data)
# ---------------------------------------------------------------------------

@router.get("/top-contacts/{msisdn}")
async def top_contacts(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    limit: int = Query(20, le=100),
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """Return top contacts with a 24x7 hour-of-day/day-of-week communication heatmap."""

    contacts = await _get_contacts_for_msisdn(db, msisdn, from_date, to_date)

    # Sort by total interactions and take top N
    sorted_contacts = sorted(
        contacts.items(),
        key=lambda x: x[1]["call_count"] + x[1]["msg_count"],
        reverse=True,
    )[:limit]

    call_time_filters = []
    if from_date:
        call_time_filters.append(CallRecord.start_time >= from_date)
    if to_date:
        call_time_filters.append(CallRecord.start_time <= to_date)

    msg_time_filters = []
    if from_date:
        msg_time_filters.append(Message.timestamp >= from_date)
    if to_date:
        msg_time_filters.append(Message.timestamp <= to_date)

    results = []
    for contact_msisdn, info in sorted_contacts:
        # Build 7x24 heatmap (day_of_week x hour_of_day) for this contact pair
        # Calls heatmap
        call_heatmap_stmt = (
            select(
                func.extract("dow", CallRecord.start_time).label("dow"),
                func.extract("hour", CallRecord.start_time).label("hr"),
                func.count().label("cnt"),
            )
            .where(
                or_(
                    and_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == contact_msisdn),
                    and_(CallRecord.caller_msisdn == contact_msisdn, CallRecord.callee_msisdn == msisdn),
                ),
                *call_time_filters,
            )
            .group_by(
                func.extract("dow", CallRecord.start_time),
                func.extract("hour", CallRecord.start_time),
            )
        )
        call_hm_result = await db.execute(call_heatmap_stmt)

        # Messages heatmap
        msg_heatmap_stmt = (
            select(
                func.extract("dow", Message.timestamp).label("dow"),
                func.extract("hour", Message.timestamp).label("hr"),
                func.count().label("cnt"),
            )
            .where(
                or_(
                    and_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == contact_msisdn),
                    and_(Message.sender_msisdn == contact_msisdn, Message.receiver_msisdn == msisdn),
                ),
                *msg_time_filters,
            )
            .group_by(
                func.extract("dow", Message.timestamp),
                func.extract("hour", Message.timestamp),
            )
        )
        msg_hm_result = await db.execute(msg_heatmap_stmt)

        # Build 7x24 matrix (Mon=0..Sun=6, hours 0..23)
        # pg dow: 0=Sun, 1=Mon ... 6=Sat -> remap to Mon=0..Sun=6
        pg_to_idx = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6}
        heatmap = [[0] * 24 for _ in range(7)]

        for row in call_hm_result.all():
            day_idx = pg_to_idx.get(int(row.dow), 0)
            heatmap[day_idx][int(row.hr)] += row.cnt
        for row in msg_hm_result.all():
            day_idx = pg_to_idx.get(int(row.dow), 0)
            heatmap[day_idx][int(row.hr)] += row.cnt

        results.append({
            "msisdn": contact_msisdn,
            "call_count": info["call_count"],
            "message_count": info["msg_count"],
            "total_duration_seconds": info["total_duration"],
            "total_interactions": info["call_count"] + info["msg_count"],
            "heatmap": heatmap,  # 7 rows (Mon-Sun) x 24 cols (hours)
        })

    return {
        "msisdn": msisdn,
        "total_contacts_analyzed": len(contacts),
        "top_n": len(results),
        "contacts": results,
    }


# ---------------------------------------------------------------------------
# 9. Report Generation (Comprehensive MSISDN Dossier)
# ---------------------------------------------------------------------------

@router.post("/report/{msisdn}")
async def generate_report(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    body: ReportRequest = ReportRequest(),
):
    """Generate a comprehensive JSON report combining all analytics for a given MSISDN.

    Acts as a 'dossier' -- entity info, CDR summary, contacts, movement,
    pattern of life, identity changes, all in one structured response.
    """
    report: dict = {
        "msisdn": msisdn,
        "generated_at": datetime.utcnow().isoformat(),
        "generated_by": user.username,
    }

    # --- Entity info ---
    pn_stmt = select(PhoneNumber).where(PhoneNumber.msisdn == msisdn)
    pn_result = await db.execute(pn_stmt)
    phone = pn_result.scalar_one_or_none()

    if phone:
        report["entity"] = {
            "phone_number_id": phone.id,
            "status": phone.status,
            "carrier": phone.carrier,
            "activation_date": phone.activation_date.isoformat() if phone.activation_date else None,
            "person_id": phone.person_id,
        }
        if phone.person_id:
            person_stmt = select(Person).where(Person.id == phone.person_id)
            person_result = await db.execute(person_stmt)
            person = person_result.scalar_one_or_none()
            if person:
                report["entity"]["person"] = {
                    "name": person.name,
                    "aliases": person.aliases,
                    "nationality": person.nationality,
                    "risk_score": person.risk_score,
                    "watchlist_status": person.watchlist_status,
                }
    else:
        report["entity"] = None

    # --- Activity stats (always included) ---
    cutoff = datetime.utcnow() - timedelta(days=body.days)

    # Call stats
    out_calls_stmt = (
        select(
            func.count().label("cnt"),
            func.coalesce(func.sum(CallRecord.duration_seconds), 0).label("dur"),
        )
        .where(CallRecord.caller_msisdn == msisdn, CallRecord.start_time >= cutoff)
    )
    in_calls_stmt = (
        select(
            func.count().label("cnt"),
            func.coalesce(func.sum(CallRecord.duration_seconds), 0).label("dur"),
        )
        .where(CallRecord.callee_msisdn == msisdn, CallRecord.start_time >= cutoff)
    )
    out_msgs_stmt = (
        select(func.count())
        .where(Message.sender_msisdn == msisdn, Message.timestamp >= cutoff)
    )
    in_msgs_stmt = (
        select(func.count())
        .where(Message.receiver_msisdn == msisdn, Message.timestamp >= cutoff)
    )

    out_calls_row = (await db.execute(out_calls_stmt)).first()
    in_calls_row = (await db.execute(in_calls_stmt)).first()
    out_msgs_count = (await db.execute(out_msgs_stmt)).scalar() or 0
    in_msgs_count = (await db.execute(in_msgs_stmt)).scalar() or 0

    report["cdr_summary"] = {
        "period_days": body.days,
        "outgoing_calls": out_calls_row.cnt if out_calls_row else 0,
        "incoming_calls": in_calls_row.cnt if in_calls_row else 0,
        "outgoing_call_duration_seconds": out_calls_row.dur if out_calls_row else 0,
        "incoming_call_duration_seconds": in_calls_row.dur if in_calls_row else 0,
        "outgoing_messages": out_msgs_count,
        "incoming_messages": in_msgs_count,
    }

    # --- Top contacts ---
    if body.include_top_contacts:
        contacts = await _get_contacts_for_msisdn(db, msisdn, cutoff, None)
        sorted_contacts = sorted(
            contacts.items(),
            key=lambda x: x[1]["call_count"] + x[1]["msg_count"],
            reverse=True,
        )[:10]
        report["top_contacts"] = [
            {"msisdn": c, "call_count": info["call_count"], "msg_count": info["msg_count"], "total_duration": info["total_duration"]}
            for c, info in sorted_contacts
        ]

    # --- Pattern of life ---
    if body.include_pattern_of_life:
        pol_response = await pattern_of_life(msisdn, db, user, days=body.days)
        report["pattern_of_life"] = {
            "sleep_location": pol_response["sleep_location"],
            "work_location": pol_response["work_location"],
            "weekend_location": pol_response["weekend_location"],
            "routine_score": pol_response["routine_score"],
            "hourly_activity": pol_response["hourly_activity"],
            "weekly_activity": pol_response["weekly_activity"],
        }

    # --- Identity changes ---
    if body.include_identity_changes and phone:
        try:
            id_response = await identity_changes(msisdn, db, user)
            report["identity_changes"] = {
                "risk_assessment": id_response["risk_assessment"],
                "changes": id_response["identity_changes"],
            }
        except HTTPException:
            report["identity_changes"] = None

    # --- Night activity summary (inline query) ---
    if body.include_night_activity:
        night_calls_count = (await db.execute(
            select(func.count()).where(
                or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
                CallRecord.start_time >= cutoff,
                or_(func.extract("hour", CallRecord.start_time) >= 23, func.extract("hour", CallRecord.start_time) < 5),
            )
        )).scalar() or 0
        night_msgs_count = (await db.execute(
            select(func.count()).where(
                or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn),
                Message.timestamp >= cutoff,
                or_(func.extract("hour", Message.timestamp) >= 23, func.extract("hour", Message.timestamp) < 5),
            )
        )).scalar() or 0
        report["night_activity_summary"] = {
            "total_night_calls": night_calls_count,
            "total_night_messages": night_msgs_count,
        }

    # --- Stats (inline query) ---
    if body.include_stats:
        total_out_calls = (await db.execute(select(func.count()).where(CallRecord.caller_msisdn == msisdn, CallRecord.start_time >= cutoff))).scalar() or 0
        total_in_calls = (await db.execute(select(func.count()).where(CallRecord.callee_msisdn == msisdn, CallRecord.start_time >= cutoff))).scalar() or 0
        total_out_msgs = (await db.execute(select(func.count()).where(Message.sender_msisdn == msisdn, Message.timestamp >= cutoff))).scalar() or 0
        total_in_msgs = (await db.execute(select(func.count()).where(Message.receiver_msisdn == msisdn, Message.timestamp >= cutoff))).scalar() or 0
        report["stats"] = {
            "total_calls": total_out_calls + total_in_calls,
            "outgoing_calls": total_out_calls,
            "incoming_calls": total_in_calls,
            "total_messages": total_out_msgs + total_in_msgs,
            "outgoing_messages": total_out_msgs,
            "incoming_messages": total_in_msgs,
        }

    return report


# ---------------------------------------------------------------------------
# 10. Activity Summary Stats
# ---------------------------------------------------------------------------

@router.get("/stats/{msisdn}")
async def activity_stats(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    days: int = Query(30, ge=1, le=365),
):
    """Quick activity summary stats for an MSISDN.

    Total calls in/out, total messages in/out, unique contacts, active days,
    average daily calls, most active hour, most active day of week.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)

    # Outgoing calls
    out_calls = (
        await db.execute(
            select(func.count()).where(
                CallRecord.caller_msisdn == msisdn,
                CallRecord.start_time >= cutoff,
            )
        )
    ).scalar() or 0

    # Incoming calls
    in_calls = (
        await db.execute(
            select(func.count()).where(
                CallRecord.callee_msisdn == msisdn,
                CallRecord.start_time >= cutoff,
            )
        )
    ).scalar() or 0

    # Outgoing messages
    out_msgs = (
        await db.execute(
            select(func.count()).where(
                Message.sender_msisdn == msisdn,
                Message.timestamp >= cutoff,
            )
        )
    ).scalar() or 0

    # Incoming messages
    in_msgs = (
        await db.execute(
            select(func.count()).where(
                Message.receiver_msisdn == msisdn,
                Message.timestamp >= cutoff,
            )
        )
    ).scalar() or 0

    # Unique contacts (calls)
    unique_call_contacts_stmt = select(
        func.count(distinct(
            sql_case(
                (CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn),
                else_=CallRecord.caller_msisdn,
            )
        ))
    ).where(
        or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
        CallRecord.start_time >= cutoff,
    )
    unique_contacts = (await db.execute(unique_call_contacts_stmt)).scalar() or 0

    # Active days (count distinct dates with any call or message)
    call_days_stmt = select(
        func.count(distinct(func.date_trunc('day', CallRecord.start_time)))
    ).where(
        or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
        CallRecord.start_time >= cutoff,
    )
    msg_days_stmt = select(
        func.count(distinct(func.date_trunc('day', Message.timestamp)))
    ).where(
        or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn),
        Message.timestamp >= cutoff,
    )
    call_active = (await db.execute(call_days_stmt)).scalar() or 0
    msg_active = (await db.execute(msg_days_stmt)).scalar() or 0
    active_days = max(call_active, msg_active)

    total_calls = out_calls + in_calls
    avg_daily_calls = round(total_calls / max(active_days, 1), 1)

    # Most active hour
    hour_stmt = (
        select(
            func.extract("hour", CallRecord.start_time).label("hr"),
            func.count().label("cnt"),
        )
        .where(
            or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
            CallRecord.start_time >= cutoff,
        )
        .group_by(func.extract("hour", CallRecord.start_time))
        .order_by(func.count().desc())
        .limit(1)
    )
    hour_result = (await db.execute(hour_stmt)).first()
    most_active_hour = int(hour_result.hr) if hour_result else None

    # Most active day of week
    dow_stmt = (
        select(
            func.extract("dow", CallRecord.start_time).label("dow"),
            func.count().label("cnt"),
        )
        .where(
            or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn),
            CallRecord.start_time >= cutoff,
        )
        .group_by(func.extract("dow", CallRecord.start_time))
        .order_by(func.count().desc())
        .limit(1)
    )
    dow_result = (await db.execute(dow_stmt)).first()
    # Map pg dow to day name
    dow_names = {0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday"}
    most_active_day = dow_names.get(int(dow_result.dow), "Unknown") if dow_result else None

    return {
        "msisdn": msisdn,
        "period_days": days,
        "outgoing_calls": out_calls,
        "incoming_calls": in_calls,
        "total_calls": total_calls,
        "outgoing_messages": out_msgs,
        "incoming_messages": in_msgs,
        "total_messages": out_msgs + in_msgs,
        "unique_contacts": unique_contacts,
        "active_days": active_days,
        "avg_daily_calls": avg_daily_calls,
        "most_active_hour": most_active_hour,
        "most_active_hour_label": f"{most_active_hour:02d}:00" if most_active_hour is not None else None,
        "most_active_day": most_active_day,
    }
