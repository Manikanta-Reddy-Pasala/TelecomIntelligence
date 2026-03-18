import math
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CallRecord, Message, LocationEvent, Tower, AnomalyAlert


class AnomalyDetectionService:
    """Detects various anomalies in telecom data."""

    @staticmethod
    async def detect_unusual_call_times(
        db: AsyncSession,
        msisdn: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Calls made between midnight and 5 AM."""
        stmt = select(CallRecord).where(
            CallRecord.caller_msisdn == msisdn,
            func.extract("hour", CallRecord.start_time).between(0, 4),
        )
        if from_date:
            stmt = stmt.where(CallRecord.start_time >= from_date)
        if to_date:
            stmt = stmt.where(CallRecord.start_time <= to_date)
        stmt = stmt.order_by(CallRecord.start_time)

        result = await db.execute(stmt)
        records = result.scalars().all()
        return [
            {
                "call_id": r.id,
                "callee_msisdn": r.callee_msisdn,
                "start_time": r.start_time.isoformat(),
                "duration_seconds": r.duration_seconds,
                "anomaly": "unusual_call_time",
            }
            for r in records
        ]

    @staticmethod
    async def detect_new_contact_burst(
        db: AsyncSession,
        msisdn: str,
        window_days: int = 7,
        threshold: int = 10,
    ) -> list[dict]:
        """Detect sudden burst of new contacts within a window."""
        # Get all contacts before the window
        now = datetime.utcnow()
        window_start = now - timedelta(days=window_days)

        old_contacts_stmt = select(CallRecord.callee_msisdn).where(
            CallRecord.caller_msisdn == msisdn,
            CallRecord.start_time < window_start,
        ).distinct()
        old_res = await db.execute(old_contacts_stmt)
        old_contacts = {r[0] for r in old_res.all()}

        # Get contacts in the window
        new_contacts_stmt = select(
            CallRecord.callee_msisdn,
            func.min(CallRecord.start_time).label("first_call"),
        ).where(
            CallRecord.caller_msisdn == msisdn,
            CallRecord.start_time >= window_start,
        ).group_by(CallRecord.callee_msisdn)
        new_res = await db.execute(new_contacts_stmt)
        new_in_window = [
            {"msisdn": r.callee_msisdn, "first_call": r.first_call.isoformat()}
            for r in new_res.all()
            if r.callee_msisdn not in old_contacts
        ]

        if len(new_in_window) >= threshold:
            return [{
                "anomaly": "new_contact_burst",
                "new_contact_count": len(new_in_window),
                "window_days": window_days,
                "threshold": threshold,
                "new_contacts": new_in_window[:20],
            }]
        return []

    @staticmethod
    async def detect_impossible_travel(
        db: AsyncSession,
        msisdn: str,
        max_speed_kmh: float = 300.0,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> list[dict]:
        """Detect when a number appears at distant towers within a timeframe that implies impossible travel speed."""
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

        anomalies = []
        for i in range(1, len(rows)):
            loc1, tower1 = rows[i - 1]
            loc2, tower2 = rows[i]

            time_diff = (loc2.timestamp - loc1.timestamp).total_seconds()
            if time_diff <= 0:
                continue

            dist_km = _haversine(tower1.latitude, tower1.longitude, tower2.latitude, tower2.longitude)
            speed_kmh = (dist_km / time_diff) * 3600

            if speed_kmh > max_speed_kmh:
                anomalies.append({
                    "anomaly": "impossible_travel",
                    "from_tower": tower1.tower_id,
                    "to_tower": tower2.tower_id,
                    "from_time": loc1.timestamp.isoformat(),
                    "to_time": loc2.timestamp.isoformat(),
                    "distance_km": round(dist_km, 2),
                    "time_diff_seconds": round(time_diff, 0),
                    "implied_speed_kmh": round(speed_kmh, 1),
                })

        return anomalies

    @staticmethod
    async def detect_volume_anomaly(
        db: AsyncSession,
        msisdn: str,
        window_days: int = 7,
        std_multiplier: float = 2.0,
    ) -> list[dict]:
        """Detect sudden spikes in daily call/message volume."""
        now = datetime.utcnow()
        baseline_start = now - timedelta(days=90)
        window_start = now - timedelta(days=window_days)

        # Daily call counts for baseline period
        daily_stmt = (
            select(
                func.date_trunc("day", CallRecord.start_time).label("day"),
                func.count().label("cnt"),
            )
            .where(
                CallRecord.caller_msisdn == msisdn,
                CallRecord.start_time >= baseline_start,
                CallRecord.start_time < window_start,
            )
            .group_by(func.date_trunc("day", CallRecord.start_time))
        )
        daily_res = await db.execute(daily_stmt)
        daily_counts = [r.cnt for r in daily_res.all()]

        if len(daily_counts) < 7:
            return []

        avg = sum(daily_counts) / len(daily_counts)
        variance = sum((c - avg) ** 2 for c in daily_counts) / len(daily_counts)
        std = math.sqrt(variance) if variance > 0 else 1.0
        threshold = avg + std_multiplier * std

        # Recent window daily counts
        recent_stmt = (
            select(
                func.date_trunc("day", CallRecord.start_time).label("day"),
                func.count().label("cnt"),
            )
            .where(
                CallRecord.caller_msisdn == msisdn,
                CallRecord.start_time >= window_start,
            )
            .group_by(func.date_trunc("day", CallRecord.start_time))
        )
        recent_res = await db.execute(recent_stmt)
        anomalies = []
        for row in recent_res.all():
            if row.cnt > threshold:
                anomalies.append({
                    "anomaly": "volume_spike",
                    "date": row.day.isoformat() if row.day else None,
                    "call_count": row.cnt,
                    "baseline_avg": round(avg, 1),
                    "baseline_std": round(std, 1),
                    "threshold": round(threshold, 1),
                })

        return anomalies

    @staticmethod
    async def get_anomalies_for_msisdn(
        db: AsyncSession,
        msisdn: str,
    ) -> list[AnomalyAlert]:
        stmt = (
            select(AnomalyAlert)
            .where(AnomalyAlert.msisdn == msisdn)
            .order_by(AnomalyAlert.detected_at.desc())
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c
