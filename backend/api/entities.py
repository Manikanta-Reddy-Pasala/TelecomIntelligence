from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from models.database import Person, PhoneNumber, Device, Tower, CallRecord, Message
from schemas.entities import (
    PersonCreate, PersonUpdate, PersonResponse, PersonListResponse,
    PhoneNumberResponse, PhoneDetailResponse,
    DeviceResponse, TowerResponse, SearchResult,
)
from api.deps import DB, CurrentUser
from services.entity_resolution import EntityResolutionService

router = APIRouter(prefix="/api/entities", tags=["entities"])


# ---------------------------------------------------------------------------
# Persons
# ---------------------------------------------------------------------------

@router.get("/persons", response_model=list[PersonListResponse])
async def list_persons(
    db: DB,
    user: CurrentUser,
    q: Optional[str] = None,
    search: Optional[str] = None,
    watchlist: Optional[bool] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    page: Optional[int] = None,
):
    actual_q = q or search
    actual_offset = offset if page is None else (page - 1) * limit
    stmt = select(Person).order_by(Person.created_at.desc()).offset(actual_offset).limit(limit)
    if actual_q:
        stmt = stmt.where(Person.name.ilike(f"%{actual_q}%"))
    if watchlist is not None:
        stmt = stmt.where(Person.watchlist_status == watchlist)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/persons", response_model=PersonResponse, status_code=201)
async def create_person(payload: PersonCreate, db: DB, user: CurrentUser):
    person = Person(**payload.model_dump())
    db.add(person)
    await db.flush()
    await db.refresh(person)
    return person


@router.get("/persons/{person_id}", response_model=PersonResponse)
async def get_person(person_id: int, db: DB, user: CurrentUser):
    stmt = (
        select(Person)
        .options(selectinload(Person.phone_numbers), selectinload(Person.devices))
        .where(Person.id == person_id)
    )
    result = await db.execute(stmt)
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


@router.put("/persons/{person_id}", response_model=PersonResponse)
async def update_person(person_id: int, payload: PersonUpdate, db: DB, user: CurrentUser):
    stmt = select(Person).where(Person.id == person_id)
    result = await db.execute(stmt)
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(person, field, value)
    await db.flush()
    await db.refresh(person)
    return person


# ---------------------------------------------------------------------------
# Phones
# ---------------------------------------------------------------------------

@router.get("/phones/{msisdn}", response_model=PhoneDetailResponse)
async def get_phone(msisdn: str, db: DB, user: CurrentUser):
    stmt = select(PhoneNumber).where(PhoneNumber.msisdn == msisdn)
    result = await db.execute(stmt)
    phone = result.scalar_one_or_none()
    if not phone:
        raise HTTPException(status_code=404, detail="Phone number not found")

    # CDR summary
    call_count_stmt = select(func.count()).where(
        or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn)
    )
    call_count = (await db.execute(call_count_stmt)).scalar() or 0

    msg_count_stmt = select(func.count()).where(
        or_(Message.sender_msisdn == msisdn, Message.receiver_msisdn == msisdn)
    )
    msg_count = (await db.execute(msg_count_stmt)).scalar() or 0

    first_seen_stmt = select(func.min(CallRecord.start_time)).where(
        or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn)
    )
    first_seen = (await db.execute(first_seen_stmt)).scalar()

    last_seen_stmt = select(func.max(CallRecord.start_time)).where(
        or_(CallRecord.caller_msisdn == msisdn, CallRecord.callee_msisdn == msisdn)
    )
    last_seen = (await db.execute(last_seen_stmt)).scalar()

    # Get person if linked
    person = None
    if phone.person_id:
        p_stmt = select(Person).where(Person.id == phone.person_id)
        p_res = await db.execute(p_stmt)
        person = p_res.scalar_one_or_none()

    return PhoneDetailResponse(
        id=phone.id,
        msisdn=phone.msisdn,
        person_id=phone.person_id,
        activation_date=phone.activation_date,
        status=phone.status,
        carrier=phone.carrier,
        created_at=phone.created_at,
        person=person,
        call_count=call_count,
        message_count=msg_count,
        first_seen=first_seen,
        last_seen=last_seen,
    )


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------

@router.get("/devices/{imei}", response_model=DeviceResponse)
async def get_device(imei: str, db: DB, user: CurrentUser):
    stmt = select(Device).where(Device.imei == imei)
    result = await db.execute(stmt)
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


# ---------------------------------------------------------------------------
# Towers
# ---------------------------------------------------------------------------

@router.get("/towers", response_model=list[TowerResponse])
async def list_towers(
    db: DB,
    user: CurrentUser,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lng: Optional[float] = None,
    max_lng: Optional[float] = None,
    city: Optional[str] = None,
    limit: int = Query(100, le=500),
):
    stmt = select(Tower).limit(limit)
    if min_lat is not None:
        stmt = stmt.where(Tower.latitude >= min_lat)
    if max_lat is not None:
        stmt = stmt.where(Tower.latitude <= max_lat)
    if min_lng is not None:
        stmt = stmt.where(Tower.longitude >= min_lng)
    if max_lng is not None:
        stmt = stmt.where(Tower.longitude <= max_lng)
    if city:
        stmt = stmt.where(Tower.city.ilike(f"%{city}%"))
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/towers/{tower_id}", response_model=TowerResponse)
async def get_tower(tower_id: int, db: DB, user: CurrentUser):
    stmt = select(Tower).where(Tower.id == tower_id)
    result = await db.execute(stmt)
    tower = result.scalar_one_or_none()
    if not tower:
        raise HTTPException(status_code=404, detail="Tower not found")
    return tower


# ---------------------------------------------------------------------------
# Unified search
# ---------------------------------------------------------------------------

@router.get("/search", response_model=list[SearchResult])
async def unified_search(
    db: DB,
    user: CurrentUser,
    q: str = Query(min_length=2),
    limit: int = Query(20, le=50),
):
    return await EntityResolutionService.unified_search(db, q, limit)
