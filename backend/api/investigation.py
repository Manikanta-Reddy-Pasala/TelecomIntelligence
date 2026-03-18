from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from models.database import Case, CaseEntity, CaseInsight
from schemas.investigation import (
    CaseCreate, CaseUpdate, CaseResponse, CaseListResponse,
    CaseEntityCreate, CaseEntityResponse,
    CaseInsightCreate, CaseInsightResponse,
)
from api.deps import DB, CurrentUser

router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.get("", response_model=list[CaseListResponse])
async def list_cases(
    db: DB,
    user: CurrentUser,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    stmt = select(Case).order_by(Case.created_at.desc()).offset(offset).limit(limit)
    if status:
        stmt = stmt.where(Case.status == status)
    if priority:
        stmt = stmt.where(Case.priority == priority)
    # Analysts only see their own assigned cases; supervisors/admins see all
    if user.role == "analyst":
        stmt = stmt.where(Case.assigned_analyst_id == user.id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=CaseResponse, status_code=201)
async def create_case(payload: CaseCreate, db: DB, user: CurrentUser):
    case = Case(
        case_number=payload.case_number,
        title=payload.title,
        description=payload.description,
        status=payload.status,
        priority=payload.priority,
        assigned_analyst_id=payload.assigned_analyst_id,
        created_by_id=user.id,
    )
    db.add(case)
    await db.flush()
    await db.refresh(case)
    return case


@router.get("/{case_id}", response_model=CaseResponse)
async def get_case(case_id: int, db: DB, user: CurrentUser):
    stmt = (
        select(Case)
        .options(selectinload(Case.entities), selectinload(Case.insights))
        .where(Case.id == case_id)
    )
    result = await db.execute(stmt)
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.put("/{case_id}", response_model=CaseResponse)
async def update_case(case_id: int, payload: CaseUpdate, db: DB, user: CurrentUser):
    stmt = select(Case).where(Case.id == case_id)
    result = await db.execute(stmt)
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(case, field, value)
    await db.flush()
    await db.refresh(case)
    return case


@router.delete("/{case_id}", status_code=204)
async def delete_case(case_id: int, db: DB, user: CurrentUser):
    stmt = select(Case).where(Case.id == case_id)
    result = await db.execute(stmt)
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    await db.delete(case)
    await db.flush()


# ---------------------------------------------------------------------------
# Case entities
# ---------------------------------------------------------------------------

@router.post("/{case_id}/entities", response_model=CaseEntityResponse, status_code=201)
async def add_entity_to_case(case_id: int, payload: CaseEntityCreate, db: DB, user: CurrentUser):
    # Verify case exists
    stmt = select(Case).where(Case.id == case_id)
    result = await db.execute(stmt)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Case not found")

    entity = CaseEntity(
        case_id=case_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        notes=payload.notes,
    )
    db.add(entity)
    await db.flush()
    await db.refresh(entity)
    return entity


@router.get("/{case_id}/entities", response_model=list[CaseEntityResponse])
async def list_case_entities(case_id: int, db: DB, user: CurrentUser):
    stmt = select(CaseEntity).where(CaseEntity.case_id == case_id).order_by(CaseEntity.added_at)
    result = await db.execute(stmt)
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Case insights / notebook
# ---------------------------------------------------------------------------

@router.post("/{case_id}/insights", response_model=CaseInsightResponse, status_code=201)
async def save_insight(case_id: int, payload: CaseInsightCreate, db: DB, user: CurrentUser):
    stmt = select(Case).where(Case.id == case_id)
    result = await db.execute(stmt)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Case not found")

    insight = CaseInsight(
        case_id=case_id,
        insight_type=payload.insight_type,
        content=payload.content,
        confidence_score=payload.confidence_score,
        evidence_refs=payload.evidence_refs,
        created_by=user.username,
    )
    db.add(insight)
    await db.flush()
    await db.refresh(insight)
    return insight


@router.get("/{case_id}/notebook", response_model=list[CaseInsightResponse])
async def get_notebook(case_id: int, db: DB, user: CurrentUser):
    stmt = (
        select(CaseInsight)
        .where(CaseInsight.case_id == case_id)
        .order_by(CaseInsight.created_at)
    )
    result = await db.execute(stmt)
    return result.scalars().all()
