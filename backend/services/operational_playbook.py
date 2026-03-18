"""Operational playbook service: CRUD + execution tracking."""

from datetime import datetime
from collections import Counter

from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import OperationalPlaybook, PlaybookExecution, CaptureHistory, LocationEvent


async def get_playbooks(db: AsyncSession, target_type: str | None = None) -> list[OperationalPlaybook]:
    """List all playbooks, optionally filtered by target type."""
    stmt = select(OperationalPlaybook).order_by(OperationalPlaybook.target_type)
    if target_type:
        stmt = stmt.where(OperationalPlaybook.target_type == target_type)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_playbook(db: AsyncSession, playbook_id: int) -> OperationalPlaybook | None:
    stmt = select(OperationalPlaybook).where(OperationalPlaybook.id == playbook_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def start_execution(
    db: AsyncSession,
    playbook_id: int,
    msisdn: str | None,
    case_id: int | None,
    analyst_id: int,
    notes: str | None,
) -> PlaybookExecution:
    """Start a new playbook execution."""
    playbook = await get_playbook(db, playbook_id)
    if not playbook:
        raise ValueError(f"Playbook {playbook_id} not found")

    # Initialize step progress from playbook steps
    steps = playbook.steps or []
    step_progress = [
        {
            "step_number": s.get("step_number", i + 1),
            "title": s.get("title", f"Step {i + 1}"),
            "status": "pending",
            "notes": None,
            "result": None,
        }
        for i, s in enumerate(steps)
    ]

    execution = PlaybookExecution(
        playbook_id=playbook_id,
        msisdn=msisdn,
        case_id=case_id,
        status="active",
        step_progress=step_progress,
        analyst_id=analyst_id,
        notes=notes,
    )
    db.add(execution)
    await db.flush()
    return execution


async def update_execution(
    db: AsyncSession,
    execution_id: int,
    step_updates: list[dict] | None = None,
    status: str | None = None,
) -> PlaybookExecution | None:
    """Update execution steps and/or status."""
    stmt = select(PlaybookExecution).where(PlaybookExecution.id == execution_id)
    result = await db.execute(stmt)
    execution = result.scalar_one_or_none()
    if not execution:
        return None

    if step_updates:
        progress = list(execution.step_progress or [])
        for update in step_updates:
            step_num = update.get("step_number")
            for step in progress:
                if step.get("step_number") == step_num:
                    if "status" in update:
                        step["status"] = update["status"]
                    if "notes" in update:
                        step["notes"] = update["notes"]
                    if "result" in update:
                        step["result"] = update["result"]
                    break
        execution.step_progress = progress

    if status:
        execution.status = status
        if status in ("completed", "aborted"):
            execution.completed_at = datetime.utcnow()

    await db.flush()
    return execution


async def get_executions(
    db: AsyncSession,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List executions with playbook names."""
    stmt = (
        select(PlaybookExecution, OperationalPlaybook.name)
        .join(OperationalPlaybook, PlaybookExecution.playbook_id == OperationalPlaybook.id)
        .order_by(desc(PlaybookExecution.started_at))
    )
    if status:
        stmt = stmt.where(PlaybookExecution.status == status)
    stmt = stmt.offset(offset).limit(limit)

    result = await db.execute(stmt)
    rows = result.all()

    return [
        {
            "id": ex.id,
            "playbook_id": ex.playbook_id,
            "playbook_name": name,
            "msisdn": ex.msisdn,
            "case_id": ex.case_id,
            "status": ex.status,
            "step_progress": ex.step_progress,
            "started_at": ex.started_at,
            "completed_at": ex.completed_at,
            "analyst_id": ex.analyst_id,
            "notes": ex.notes,
        }
        for ex, name in rows
    ]


async def suggest_playbook(
    db: AsyncSession,
    msisdn: str,
) -> dict:
    """Suggest a playbook based on the target's communication patterns."""
    # Analyze the MSISDN's behavior patterns
    from models.database import CallRecord, Message

    # Count calls
    call_cnt_stmt = select(func.count()).where(
        (CallRecord.caller_msisdn == msisdn) | (CallRecord.callee_msisdn == msisdn)
    )
    call_cnt = (await db.execute(call_cnt_stmt)).scalar() or 0

    # Count unique contacts
    caller_contacts = select(CallRecord.callee_msisdn).where(CallRecord.caller_msisdn == msisdn)
    callee_contacts = select(CallRecord.caller_msisdn).where(CallRecord.callee_msisdn == msisdn)

    # Count messages
    msg_cnt_stmt = select(func.count()).where(
        (Message.sender_msisdn == msisdn) | (Message.receiver_msisdn == msisdn)
    )
    msg_cnt = (await db.execute(msg_cnt_stmt)).scalar() or 0

    # Location variety
    loc_tower_stmt = (
        select(func.count(func.distinct(LocationEvent.tower_id)))
        .where(LocationEvent.msisdn == msisdn)
    )
    tower_variety = (await db.execute(loc_tower_stmt)).scalar() or 0

    # Heuristic scoring for each target type
    playbooks = await get_playbooks(db)
    scores = {}

    for pb in playbooks:
        score = 0.5  # base
        tt = pb.target_type

        if tt == "drug" and call_cnt > 500 and tower_variety > 10:
            score = 0.8
        elif tt == "fraud" and msg_cnt > 200 and call_cnt > 300:
            score = 0.75
        elif tt == "terror" and tower_variety < 5 and call_cnt < 100:
            score = 0.6
        elif tt == "kidnap" and tower_variety > 15:
            score = 0.7
        elif tt == "organized_crime" and call_cnt > 1000:
            score = 0.85

        scores[pb.id] = {"playbook": pb, "score": score}

    if not scores:
        return {
            "suggested_playbook": None,
            "confidence": 0.0,
            "reason": "No playbooks available",
            "alternative_playbooks": [],
        }

    sorted_scores = sorted(scores.values(), key=lambda x: -x["score"])
    best = sorted_scores[0]

    reasons = {
        "drug": "High call volume with diverse tower usage suggests mobile operations",
        "fraud": "High message + call volume pattern consistent with fraud operations",
        "terror": "Low mobility with limited contacts suggests cell structure",
        "kidnap": "High tower variety suggests frequent movement/transport",
        "organized_crime": "Very high call volume indicates coordination role",
    }

    return {
        "suggested_playbook": best["playbook"],
        "confidence": round(best["score"], 2),
        "reason": reasons.get(best["playbook"].target_type, "Pattern analysis"),
        "alternative_playbooks": [s["playbook"] for s in sorted_scores[1:3]],
    }
