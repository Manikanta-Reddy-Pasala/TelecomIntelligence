"""Capture history service: record, query, find similar past captures."""

from datetime import datetime
from collections import defaultdict

from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CaptureHistory, LocationEvent


async def create_capture(
    db: AsyncSession,
    msisdn: str,
    method: str,
    cells_used: list[str],
    success: bool,
    duration_hours: float,
    time_of_day: str | None,
    notes: str | None,
    case_id: int | None,
    analyst_id: int | None,
) -> CaptureHistory:
    """Record a new capture."""
    cap = CaptureHistory(
        msisdn=msisdn,
        method=method,
        cells_used=cells_used,
        success=success,
        duration_hours=duration_hours,
        time_of_day=time_of_day,
        notes=notes,
        case_id=case_id,
        analyst_id=analyst_id,
    )
    db.add(cap)
    await db.flush()
    return cap


async def get_captures(
    db: AsyncSession,
    msisdn: str | None = None,
    method: str | None = None,
    success: bool | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[CaptureHistory]:
    """Query capture history with optional filters."""
    stmt = select(CaptureHistory).order_by(desc(CaptureHistory.created_at))

    if msisdn:
        stmt = stmt.where(CaptureHistory.msisdn == msisdn)
    if method:
        stmt = stmt.where(CaptureHistory.method == method)
    if success is not None:
        stmt = stmt.where(CaptureHistory.success == success)

    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_metrics(db: AsyncSession) -> dict:
    """Compute capture metrics."""
    all_stmt = select(CaptureHistory)
    result = await db.execute(all_stmt)
    captures = list(result.scalars().all())

    if not captures:
        return {
            "total_captures": 0,
            "success_rate": 0.0,
            "by_method": {},
            "by_time_of_day": {},
            "avg_duration_hours": 0.0,
            "most_effective_method": None,
            "most_effective_time": None,
        }

    total = len(captures)
    successes = sum(1 for c in captures if c.success)

    by_method = defaultdict(lambda: {"total": 0, "success": 0})
    by_time = defaultdict(lambda: {"total": 0, "success": 0})

    for c in captures:
        by_method[c.method]["total"] += 1
        if c.success:
            by_method[c.method]["success"] += 1

        tod = c.time_of_day or "unknown"
        by_time[tod]["total"] += 1
        if c.success:
            by_time[tod]["success"] += 1

    for d in list(by_method.values()) + list(by_time.values()):
        d["rate"] = round(d["success"] / max(d["total"], 1), 3)

    best_method = max(by_method.items(), key=lambda x: x[1]["rate"], default=(None, {}))
    best_time = max(by_time.items(), key=lambda x: x[1]["rate"], default=(None, {}))

    avg_dur = sum(c.duration_hours for c in captures) / total

    return {
        "total_captures": total,
        "success_rate": round(successes / total, 3),
        "by_method": dict(by_method),
        "by_time_of_day": dict(by_time),
        "avg_duration_hours": round(avg_dur, 2),
        "most_effective_method": best_method[0],
        "most_effective_time": best_time[0],
    }


async def find_similar(
    db: AsyncSession,
    msisdn: str,
    limit: int = 10,
) -> list[dict]:
    """Find similar past captures based on common cells and patterns."""
    # Get the target's frequently used towers
    loc_stmt = (
        select(LocationEvent.tower_id, func.count().label("cnt"))
        .where(LocationEvent.msisdn == msisdn)
        .group_by(LocationEvent.tower_id)
        .order_by(desc("cnt"))
        .limit(20)
    )
    loc_result = await db.execute(loc_stmt)
    target_towers = {str(r.tower_id) for r in loc_result.all()}

    if not target_towers:
        return []

    # Get all captures
    cap_stmt = select(CaptureHistory).order_by(desc(CaptureHistory.created_at)).limit(200)
    cap_result = await db.execute(cap_stmt)
    captures = list(cap_result.scalars().all())

    similar = []
    for cap in captures:
        cap_cells = set(cap.cells_used or [])
        common = cap_cells & target_towers
        if not common and cap.msisdn != msisdn:
            continue

        # Similarity: Jaccard + same MSISDN bonus
        union = cap_cells | target_towers
        jaccard = len(common) / max(len(union), 1)
        msisdn_bonus = 0.3 if cap.msisdn == msisdn else 0.0
        score = min(jaccard + msisdn_bonus, 1.0)

        similar.append({
            "capture": cap,
            "similarity_score": round(score, 3),
            "common_cells": list(common),
        })

    similar.sort(key=lambda x: -x["similarity_score"])
    return similar[:limit]
