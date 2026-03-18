from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query
from sqlalchemy import select, or_

from models.database import CallRecord, Message, LocationEvent, DataSession
from schemas.events import (
    CallRecordResponse, MessageResponse, LocationEventResponse,
    DataSessionResponse, TimelineEvent,
)
from api.deps import DB, CurrentUser

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("/recent")
async def recent_events(
    db: DB,
    user: CurrentUser,
    limit: int = Query(10, le=50),
):
    """Recent activity across call records and messages, merged and sorted by timestamp."""
    # Latest 10 calls
    call_stmt = select(CallRecord).order_by(CallRecord.start_time.desc()).limit(10)
    call_result = await db.execute(call_stmt)
    calls = call_result.scalars().all()

    # Latest 5 messages
    msg_stmt = select(Message).order_by(Message.timestamp.desc()).limit(5)
    msg_result = await db.execute(msg_stmt)
    messages = msg_result.scalars().all()

    events: list[dict] = []
    for c in calls:
        duration = c.duration_seconds or 0
        events.append({
            "type": "call",
            "description": f"Call from {c.caller_msisdn} to {c.callee_msisdn} ({duration}s)",
            "timestamp": c.start_time.isoformat() if c.start_time else None,
        })
    for m in messages:
        events.append({
            "type": "message",
            "description": f"Message from {m.sender_msisdn} to {m.receiver_msisdn}",
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
        })

    events.sort(key=lambda e: e["timestamp"] or "", reverse=True)
    return {"events": events[:limit]}


@router.get("/calls", response_model=list[CallRecordResponse])
async def get_calls(
    db: DB,
    user: CurrentUser,
    msisdn: Optional[str] = None,
    caller: Optional[str] = None,
    callee: Optional[str] = None,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    status: Optional[str] = None,
    limit: int = Query(100, le=1000),
    offset: int = 0,
):
    stmt = select(CallRecord).order_by(CallRecord.start_time.desc()).offset(offset).limit(limit)

    if msisdn:
        stmt = stmt.where(or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn))
    if caller:
        stmt = stmt.where(CallRecord.caller_msisdn == caller)
    if callee:
        stmt = stmt.where(CallRecord.callee_msisdn == callee)
    if from_date:
        stmt = stmt.where(CallRecord.start_time >= from_date)
    if to_date:
        stmt = stmt.where(CallRecord.start_time <= to_date)
    if status:
        stmt = stmt.where(CallRecord.status == status)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/messages", response_model=list[MessageResponse])
async def get_messages(
    db: DB,
    user: CurrentUser,
    msisdn: Optional[str] = None,
    sender: Optional[str] = None,
    receiver: Optional[str] = None,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(100, le=1000),
    offset: int = 0,
):
    stmt = select(Message).order_by(Message.timestamp.desc()).offset(offset).limit(limit)

    if msisdn:
        stmt = stmt.where(or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn))
    if sender:
        stmt = stmt.where(Message.sender_msisdn == sender)
    if receiver:
        stmt = stmt.where(Message.receiver_msisdn == receiver)
    if from_date:
        stmt = stmt.where(Message.timestamp >= from_date)
    if to_date:
        stmt = stmt.where(Message.timestamp <= to_date)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/locations", response_model=list[LocationEventResponse])
async def get_locations(
    db: DB,
    user: CurrentUser,
    msisdn: Optional[str] = None,
    tower_id: Optional[int] = None,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(200, le=2000),
    offset: int = 0,
):
    stmt = select(LocationEvent).order_by(LocationEvent.timestamp.desc()).offset(offset).limit(limit)

    if msisdn:
        stmt = stmt.where(LocationEvent.msisdn == msisdn)
    if tower_id:
        stmt = stmt.where(LocationEvent.tower_id == tower_id)
    if from_date:
        stmt = stmt.where(LocationEvent.timestamp >= from_date)
    if to_date:
        stmt = stmt.where(LocationEvent.timestamp <= to_date)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/timeline", response_model=list[TimelineEvent])
async def get_timeline(
    db: DB,
    user: CurrentUser,
    msisdn: str,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(200, le=1000),
):
    """Unified timeline: merge calls, messages, location events, data sessions sorted by time."""
    events: list[TimelineEvent] = []

    # Calls
    call_stmt = (
        select(CallRecord)
        .where(or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn))
    )
    if from_date:
        call_stmt = call_stmt.where(CallRecord.start_time >= from_date)
    if to_date:
        call_stmt = call_stmt.where(CallRecord.start_time <= to_date)
    call_res = await db.execute(call_stmt)
    for c in call_res.scalars().all():
        events.append(TimelineEvent(
            event_type="call",
            timestamp=c.start_time,
            msisdn=msisdn,
            detail={
                "caller": c.caller_msisdn, "callee": c.callee_msisdn,
                "duration": c.duration_seconds, "status": c.status, "type": c.call_type,
            },
        ))

    # Messages
    msg_stmt = (
        select(Message)
        .where(or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn))
    )
    if from_date:
        msg_stmt = msg_stmt.where(Message.timestamp >= from_date)
    if to_date:
        msg_stmt = msg_stmt.where(Message.timestamp <= to_date)
    msg_res = await db.execute(msg_stmt)
    for m in msg_res.scalars().all():
        events.append(TimelineEvent(
            event_type="message",
            timestamp=m.timestamp,
            msisdn=msisdn,
            detail={
                "sender": m.sender_msisdn, "receiver": m.receiver_msisdn,
                "type": m.message_type, "preview": m.content_preview,
            },
        ))

    # Location events
    loc_stmt = select(LocationEvent).where(LocationEvent.msisdn == msisdn)
    if from_date:
        loc_stmt = loc_stmt.where(LocationEvent.timestamp >= from_date)
    if to_date:
        loc_stmt = loc_stmt.where(LocationEvent.timestamp <= to_date)
    loc_res = await db.execute(loc_stmt)
    for le in loc_res.scalars().all():
        events.append(TimelineEvent(
            event_type="location",
            timestamp=le.timestamp,
            msisdn=msisdn,
            detail={
                "tower_id": le.tower_id, "event_type": le.event_type,
                "lac": le.lac, "cell_id": le.cell_id, "signal_strength": le.signal_strength,
            },
        ))

    # Data sessions
    ds_stmt = select(DataSession).where(DataSession.msisdn == msisdn)
    if from_date:
        ds_stmt = ds_stmt.where(DataSession.start_time >= from_date)
    if to_date:
        ds_stmt = ds_stmt.where(DataSession.start_time <= to_date)
    ds_res = await db.execute(ds_stmt)
    for d in ds_res.scalars().all():
        events.append(TimelineEvent(
            event_type="data",
            timestamp=d.start_time,
            msisdn=msisdn,
            detail={
                "bytes_up": d.bytes_uploaded, "bytes_down": d.bytes_downloaded,
                "tower_id": d.tower_id,
            },
        ))

    events.sort(key=lambda e: e.timestamp, reverse=True)
    return events[:limit]
