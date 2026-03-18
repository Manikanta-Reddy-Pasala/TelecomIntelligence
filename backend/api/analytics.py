from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Query
from sqlalchemy import select, func, or_

from models.database import (
    Tower, Person, Case, CallRecord, AnomalyAlert, PhoneNumber,
)
from schemas.investigation import AnomalyAlertResponse
from api.deps import DB, CurrentUser
from services.graph_analytics import GraphAnalyticsService
from services.geo_analytics import GeoAnalyticsService
from services.anomaly_detection import AnomalyDetectionService

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/dashboard-stats")
async def dashboard_stats(db: DB, user: CurrentUser):
    """Aggregated counts for the dashboard overview."""
    total_persons = (await db.execute(select(func.count(Person.id)))).scalar() or 0

    active_cases = (
        await db.execute(
            select(func.count(Case.id)).where(Case.status.in_(("open", "active")))
        )
    ).scalar() or 0

    twenty_four_hours_ago = datetime.utcnow() - timedelta(hours=24)
    calls_today = (
        await db.execute(
            select(func.count(CallRecord.id)).where(
                CallRecord.start_time >= twenty_four_hours_ago
            )
        )
    ).scalar() or 0

    alerts = (
        await db.execute(
            select(func.count(AnomalyAlert.id)).where(AnomalyAlert.resolved == False)  # noqa: E712
        )
    ).scalar() or 0

    total_phones = (await db.execute(select(func.count(PhoneNumber.id)))).scalar() or 0
    total_towers = (await db.execute(select(func.count(Tower.id)))).scalar() or 0

    return {
        "total_persons": total_persons,
        "active_cases": active_cases,
        "calls_today": calls_today,
        "alerts": alerts,
        "total_phones": total_phones,
        "total_towers": total_towers,
    }


@router.get("/contacts/{msisdn}")
async def contact_network(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """Get the contact network for an MSISDN (who they called/messaged, frequency, duration)."""
    contacts = await GraphAnalyticsService.get_contact_network(db, msisdn, from_date, to_date)

    # Build graph format for force-graph visualization
    nodes = [{"id": msisdn, "msisdn": msisdn, "label": msisdn, "is_target": True, "weight": 10}]
    edges = []
    for c in contacts:
        call_count = c.get("outgoing_calls", 0) + c.get("incoming_calls", 0)
        msg_count = c.get("outgoing_messages", 0) + c.get("incoming_messages", 0)
        total = call_count + msg_count
        nodes.append({
            "id": c["msisdn"],
            "msisdn": c["msisdn"],
            "label": c["msisdn"][-6:],
            "is_target": False,
            "weight": total,
            "call_count": call_count,
        })
        edges.append({
            "source": msisdn,
            "target": c["msisdn"],
            "weight": total,
            "call_count": call_count,
        })

    return {
        "msisdn": msisdn,
        "total_contacts": len(contacts),
        "contacts": contacts,
        "nodes": nodes,
        "edges": edges,
    }


@router.get("/common-contacts")
async def common_contacts(
    db: DB,
    user: CurrentUser,
    msisdn1: str = Query(...),
    msisdn2: str = Query(...),
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """Find contacts common to both MSISDNs."""
    common = await GraphAnalyticsService.find_common_contacts(db, msisdn1, msisdn2, from_date, to_date)
    return {"msisdn1": msisdn1, "msisdn2": msisdn2, "common_count": len(common), "common_contacts": common}


@router.get("/shortest-path")
async def shortest_path(
    db: DB,
    user: CurrentUser,
    source: str = Query(...),
    target: str = Query(...),
    max_hops: int = Query(4, le=6),
):
    """Find shortest contact chain between two MSISDNs."""
    path = await GraphAnalyticsService.find_shortest_path(db, source, target, max_hops)
    if path is None:
        return {"source": source, "target": target, "path": None, "hops": None, "found": False}
    return {"source": source, "target": target, "path": path, "hops": len(path) - 1, "found": True}


@router.get("/colocation")
async def colocation(
    db: DB,
    user: CurrentUser,
    msisdn1: str = Query(...),
    msisdn2: str = Query(...),
    window_minutes: int = Query(30, ge=1, le=1440),
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """Find times when both MSISDNs were at the same tower within a time window."""
    events = await GeoAnalyticsService.find_colocation(db, msisdn1, msisdn2, window_minutes, from_date, to_date)
    return {
        "msisdn1": msisdn1,
        "msisdn2": msisdn2,
        "window_minutes": window_minutes,
        "colocation_count": len(events),
        "events": events,
    }


@router.get("/movement/{msisdn}")
async def movement_trail(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """Movement trail for an MSISDN: sequence of towers with timestamps."""
    trail = await GeoAnalyticsService.get_movement_trail(db, msisdn, from_date, to_date)
    return {"msisdn": msisdn, "trail_points": len(trail), "trail": trail}


@router.get("/dwell-times/{msisdn}")
async def dwell_times(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """How long an MSISDN stayed at each tower."""
    dwells = await GeoAnalyticsService.get_dwell_times(db, msisdn, from_date, to_date)
    return {"msisdn": msisdn, "towers": dwells}


@router.get("/heatmap/{msisdn}")
async def heatmap(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """Heatmap data: tower coordinates weighted by event count."""
    data = await GeoAnalyticsService.get_heatmap_data(db, msisdn, from_date, to_date)
    return {"msisdn": msisdn, "points": data}


@router.get("/tower-activity/{tower_id}")
async def tower_activity(
    tower_id: int,
    db: DB,
    user: CurrentUser,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
):
    """All MSISDNs seen at a tower in a time range."""
    # Verify tower exists
    stmt = select(Tower).where(Tower.id == tower_id)
    result = await db.execute(stmt)
    tower = result.scalar_one_or_none()
    tower_label = tower.tower_id if tower else str(tower_id)

    activity = await GeoAnalyticsService.get_tower_activity(db, tower_id, from_date, to_date)
    return {"tower_id": tower_label, "db_id": tower_id, "msisdn_count": len(activity), "activity": activity}


@router.get("/anomalies", response_model=list[AnomalyAlertResponse])
async def list_anomalies(db: DB, user: CurrentUser, msisdn: Optional[str] = None):
    """List all unresolved anomaly alerts, optionally filtered by MSISDN."""
    stmt = (
        select(AnomalyAlert)
        .where(AnomalyAlert.resolved == False)  # noqa: E712
        .order_by(AnomalyAlert.detected_at.desc())
    )
    if msisdn:
        stmt = stmt.where(AnomalyAlert.msisdn == msisdn)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/anomalies/{msisdn}", response_model=list[AnomalyAlertResponse])
async def anomalies(msisdn: str, db: DB, user: CurrentUser):
    """Get detected anomalies for an MSISDN."""
    return await AnomalyDetectionService.get_anomalies_for_msisdn(db, msisdn)
