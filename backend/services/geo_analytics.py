import math
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import LocationEvent, Tower, CallRecord


class GeoAnalyticsService:
    """Tower-based geospatial analytics."""

    @staticmethod
    async def get_movement_trail(
        db: AsyncSession,
        msisdn: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Return a sequence of tower positions with timestamps for an MSISDN."""
        stmt = (
            select(LocationEvent, Tower)
            .join(Tower, LocationEvent.tower_id == Tower.id)
            .where(LocationEvent.msisdn == msisdn)
            .order_by(LocationEvent.timestamp)
        )
        if from_date:
            stmt = stmt.where(LocationEvent.timestamp >= from_date)
        if to_date:
            stmt = stmt.where(LocationEvent.timestamp <= to_date)

        result = await db.execute(stmt)
        trail = []
        for loc, tower in result.all():
            trail.append({
                "timestamp": loc.timestamp.isoformat(),
                "tower_id": tower.tower_id,
                "latitude": tower.latitude,
                "longitude": tower.longitude,
                "event_type": loc.event_type,
                "signal_strength": loc.signal_strength,
                "city": tower.city,
            })
        return trail

    @staticmethod
    async def find_colocation(
        db: AsyncSession,
        msisdn1: str,
        msisdn2: str,
        window_minutes: int = 30,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Find times when both MSISDNs were at the same tower within a time window."""
        # Get location events for msisdn1
        stmt1 = (
            select(LocationEvent)
            .where(LocationEvent.msisdn == msisdn1)
            .order_by(LocationEvent.timestamp)
        )
        if from_date:
            stmt1 = stmt1.where(LocationEvent.timestamp >= from_date)
        if to_date:
            stmt1 = stmt1.where(LocationEvent.timestamp <= to_date)

        stmt2 = (
            select(LocationEvent)
            .where(LocationEvent.msisdn == msisdn2)
            .order_by(LocationEvent.timestamp)
        )
        if from_date:
            stmt2 = stmt2.where(LocationEvent.timestamp >= from_date)
        if to_date:
            stmt2 = stmt2.where(LocationEvent.timestamp <= to_date)

        res1 = await db.execute(stmt1)
        res2 = await db.execute(stmt2)
        events1 = res1.scalars().all()
        events2 = res2.scalars().all()

        window = timedelta(minutes=window_minutes)
        colocations = []

        j = 0
        for e1 in events1:
            if e1.tower_id is None:
                continue
            while j < len(events2) and events2[j].timestamp < e1.timestamp - window:
                j += 1
            k = j
            while k < len(events2) and events2[k].timestamp <= e1.timestamp + window:
                if events2[k].tower_id == e1.tower_id:
                    # Fetch tower info
                    tower_stmt = select(Tower).where(Tower.id == e1.tower_id)
                    tower_res = await db.execute(tower_stmt)
                    tower = tower_res.scalar_one_or_none()
                    colocations.append({
                        "tower_id": tower.tower_id if tower else str(e1.tower_id),
                        "latitude": tower.latitude if tower else None,
                        "longitude": tower.longitude if tower else None,
                        "msisdn1_time": e1.timestamp.isoformat(),
                        "msisdn2_time": events2[k].timestamp.isoformat(),
                        "time_diff_seconds": abs((e1.timestamp - events2[k].timestamp).total_seconds()),
                    })
                k += 1

        return colocations

    @staticmethod
    async def get_dwell_times(
        db: AsyncSession,
        msisdn: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Calculate how long an MSISDN stayed at each tower."""
        stmt = (
            select(LocationEvent, Tower)
            .join(Tower, LocationEvent.tower_id == Tower.id)
            .where(LocationEvent.msisdn == msisdn)
            .order_by(LocationEvent.timestamp)
        )
        if from_date:
            stmt = stmt.where(LocationEvent.timestamp >= from_date)
        if to_date:
            stmt = stmt.where(LocationEvent.timestamp <= to_date)

        result = await db.execute(stmt)
        rows = result.all()

        if not rows:
            return []

        dwells: dict[str, dict] = {}
        prev_tower_id = None
        prev_time = None

        for loc, tower in rows:
            if prev_tower_id == tower.tower_id and prev_time:
                diff = (loc.timestamp - prev_time).total_seconds()
                # Only count if gap is less than 2 hours (otherwise probably disconnected)
                if diff < 7200:
                    entry = dwells.setdefault(tower.tower_id, {
                        "tower_id": tower.tower_id,
                        "latitude": tower.latitude,
                        "longitude": tower.longitude,
                        "city": tower.city,
                        "total_dwell_seconds": 0,
                        "visit_count": 0,
                    })
                    entry["total_dwell_seconds"] += diff
            if prev_tower_id != tower.tower_id:
                entry = dwells.setdefault(tower.tower_id, {
                    "tower_id": tower.tower_id,
                    "latitude": tower.latitude,
                    "longitude": tower.longitude,
                    "city": tower.city,
                    "total_dwell_seconds": 0,
                    "visit_count": 0,
                })
                entry["visit_count"] += 1

            prev_tower_id = tower.tower_id
            prev_time = loc.timestamp

        return sorted(dwells.values(), key=lambda x: x["total_dwell_seconds"], reverse=True)

    @staticmethod
    async def get_tower_activity(
        db: AsyncSession,
        tower_db_id: int,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """All MSISDNs seen at a given tower in a time range."""
        stmt = (
            select(
                LocationEvent.msisdn,
                func.count().label("event_count"),
                func.min(LocationEvent.timestamp).label("first_seen"),
                func.max(LocationEvent.timestamp).label("last_seen"),
            )
            .where(LocationEvent.tower_id == tower_db_id)
        )
        if from_date:
            stmt = stmt.where(LocationEvent.timestamp >= from_date)
        if to_date:
            stmt = stmt.where(LocationEvent.timestamp <= to_date)
        stmt = stmt.group_by(LocationEvent.msisdn).order_by(func.count().desc())

        result = await db.execute(stmt)
        return [
            {
                "msisdn": row.msisdn,
                "event_count": row.event_count,
                "first_seen": row.first_seen.isoformat() if row.first_seen else None,
                "last_seen": row.last_seen.isoformat() if row.last_seen else None,
            }
            for row in result.all()
        ]

    @staticmethod
    async def get_heatmap_data(
        db: AsyncSession,
        msisdn: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Generate heatmap data (tower lat/lng with event count weights)."""
        stmt = (
            select(
                Tower.latitude,
                Tower.longitude,
                Tower.tower_id,
                func.count().label("weight"),
            )
            .join(LocationEvent, LocationEvent.tower_id == Tower.id)
            .where(LocationEvent.msisdn == msisdn)
        )
        if from_date:
            stmt = stmt.where(LocationEvent.timestamp >= from_date)
        if to_date:
            stmt = stmt.where(LocationEvent.timestamp <= to_date)
        stmt = stmt.group_by(Tower.latitude, Tower.longitude, Tower.tower_id)

        result = await db.execute(stmt)
        return [
            {"latitude": r.latitude, "longitude": r.longitude, "tower_id": r.tower_id, "weight": r.weight}
            for r in result.all()
        ]
