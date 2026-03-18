"""Cell/Tower recommendation engine for operational intelligence."""

import math
from datetime import datetime, timedelta
from collections import defaultdict

from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Tower, LocationEvent, CallRecord, CaptureHistory, TowerRFProfile


async def recommend_cells(
    db: AsyncSession,
    msisdn: str,
    days: int = 90,
    top_n: int = 20,
) -> dict:
    """
    Score and rank towers for a target MSISDN.

    Score = 0.4 * usage_freq + 0.2 * recency + 0.15 * time_consistency
          + 0.15 * capture_success + 0.1 * rf_suitability
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    now = datetime.utcnow()

    # 1. Get tower usage from location events
    loc_stmt = (
        select(
            LocationEvent.tower_id,
            func.count().label("visit_count"),
            func.max(LocationEvent.timestamp).label("last_seen"),
        )
        .where(
            and_(
                LocationEvent.msisdn == msisdn,
                LocationEvent.timestamp >= cutoff,
            )
        )
        .group_by(LocationEvent.tower_id)
    )
    loc_result = await db.execute(loc_stmt)
    tower_usage = {row.tower_id: {"count": row.visit_count, "last_seen": row.last_seen} for row in loc_result.all()}

    # Also count call records at towers
    for role in ["caller", "callee"]:
        msisdn_col = getattr(CallRecord, f"{role}_msisdn")
        tower_col = getattr(CallRecord, f"{role}_tower_id")
        call_stmt = (
            select(tower_col, func.count().label("cnt"))
            .where(and_(msisdn_col == msisdn, CallRecord.start_time >= cutoff))
            .group_by(tower_col)
        )
        call_result = await db.execute(call_stmt)
        for row in call_result.all():
            if row[0] is None:
                continue
            if row[0] in tower_usage:
                tower_usage[row[0]]["count"] += row.cnt
            else:
                tower_usage[row[0]] = {"count": row.cnt, "last_seen": None}

    if not tower_usage:
        return {
            "msisdn": msisdn,
            "recommendations": [],
            "analysis_period_days": days,
            "total_towers_analyzed": 0,
            "time_of_day_heatmap": {},
        }

    # 2. Time-of-day heatmap
    tod_stmt = (
        select(
            func.extract("hour", LocationEvent.timestamp).label("hour"),
            func.count().label("cnt"),
        )
        .where(and_(LocationEvent.msisdn == msisdn, LocationEvent.timestamp >= cutoff))
        .group_by("hour")
    )
    tod_result = await db.execute(tod_stmt)
    time_heatmap = {int(r.hour): r.cnt for r in tod_result.all()}

    # 3. Per-tower time consistency (how regularly they appear at the tower)
    tower_hours_stmt = (
        select(
            LocationEvent.tower_id,
            func.extract("hour", LocationEvent.timestamp).label("hour"),
            func.count().label("cnt"),
        )
        .where(and_(LocationEvent.msisdn == msisdn, LocationEvent.timestamp >= cutoff))
        .group_by(LocationEvent.tower_id, "hour")
    )
    th_result = await db.execute(tower_hours_stmt)
    tower_hour_counts = defaultdict(lambda: defaultdict(int))
    for row in th_result.all():
        tower_hour_counts[row.tower_id][int(row.hour)] += row.cnt

    # 4. Capture history success at towers
    cap_stmt = (
        select(CaptureHistory)
        .where(CaptureHistory.msisdn == msisdn)
    )
    cap_result = await db.execute(cap_stmt)
    captures = cap_result.scalars().all()

    tower_capture_success = defaultdict(lambda: {"total": 0, "success": 0})
    for cap in captures:
        cells = cap.cells_used or []
        for cell_id in cells:
            tower_capture_success[cell_id]["total"] += 1
            if cap.success:
                tower_capture_success[cell_id]["success"] += 1

    # 5. RF profiles
    rf_stmt = select(TowerRFProfile)
    rf_result = await db.execute(rf_stmt)
    rf_profiles = {p.tower_id: p for p in rf_result.scalars().all()}

    # 6. Load tower details
    tower_ids = list(tower_usage.keys())
    tower_stmt = select(Tower).where(Tower.id.in_(tower_ids))
    tower_result = await db.execute(tower_stmt)
    towers = {t.id: t for t in tower_result.scalars().all()}

    # Compute scores
    max_count = max((u["count"] for u in tower_usage.values()), default=1)
    max_recency = max(
        ((now - u["last_seen"]).total_seconds() if u["last_seen"] else days * 86400 for u in tower_usage.values()),
        default=1,
    )

    scored = []
    for tid, usage in tower_usage.items():
        tower = towers.get(tid)
        if not tower:
            continue

        # Usage frequency (0-1)
        usage_score = usage["count"] / max(max_count, 1)

        # Recency (0-1, more recent = higher)
        if usage["last_seen"]:
            age_s = (now - usage["last_seen"]).total_seconds()
            recency_score = 1.0 - (age_s / max(max_recency, 1))
        else:
            recency_score = 0.0

        # Time consistency: entropy-based (regular pattern = higher)
        hours = tower_hour_counts.get(tid, {})
        total_h = sum(hours.values()) or 1
        probs = [c / total_h for c in hours.values()]
        entropy = -sum(p * math.log2(p) for p in probs if p > 0)
        max_entropy = math.log2(24)
        time_consistency = 1.0 - (entropy / max_entropy) if max_entropy > 0 else 0

        # Capture success at this tower
        cap_data = tower_capture_success.get(tower.tower_id, {"total": 0, "success": 0})
        capture_success = cap_data["success"] / max(cap_data["total"], 1) if cap_data["total"] > 0 else 0.5

        # RF suitability (prefer towers with profiles and good coverage)
        rf = rf_profiles.get(tower.tower_id)
        rf_suitability = 0.7 if rf else 0.3

        total = (
            0.4 * usage_score
            + 0.2 * recency_score
            + 0.15 * time_consistency
            + 0.15 * capture_success
            + 0.1 * rf_suitability
        )

        # Recommended times: top 3 hours at this tower
        top_hours = sorted(hours.items(), key=lambda x: -x[1])[:3]
        rec_times = [f"{h:02d}:00-{(h+2)%24:02d}:00" for h, _ in top_hours]

        scored.append({
            "tower_id": tower.tower_id,
            "tower_db_id": tower.id,
            "latitude": tower.latitude,
            "longitude": tower.longitude,
            "address": tower.address,
            "total_score": round(total, 4),
            "usage_score": round(usage_score, 4),
            "recency_score": round(recency_score, 4),
            "time_consistency_score": round(time_consistency, 4),
            "capture_success_score": round(capture_success, 4),
            "rf_suitability_score": round(rf_suitability, 4),
            "visit_count": usage["count"],
            "last_seen": usage["last_seen"],
            "recommended_times": rec_times,
        })

    scored.sort(key=lambda x: -x["total_score"])

    return {
        "msisdn": msisdn,
        "recommendations": scored[:top_n],
        "analysis_period_days": days,
        "total_towers_analyzed": len(scored),
        "time_of_day_heatmap": time_heatmap,
    }
