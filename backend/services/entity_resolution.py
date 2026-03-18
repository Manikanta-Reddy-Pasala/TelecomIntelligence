from typing import Optional

from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.database import Person, PhoneNumber, Device, SIM, Tower
from schemas.entities import SearchResult


class EntityResolutionService:
    """Resolves identities across SIMs, devices, and phone numbers."""

    @staticmethod
    async def resolve_identity(db: AsyncSession, identifier: str) -> dict:
        """Given an MSISDN, IMEI, or IMSI, resolve to a full identity graph."""
        result: dict = {
            "person": None,
            "phone_numbers": [],
            "devices": [],
            "sims": [],
            "confidence": 0.0,
        }

        # Try MSISDN lookup
        phone_stmt = select(PhoneNumber).where(PhoneNumber.msisdn == identifier)
        phone_res = await db.execute(phone_stmt)
        phone = phone_res.scalar_one_or_none()

        if phone and phone.person_id:
            person_stmt = (
                select(Person)
                .options(selectinload(Person.phone_numbers), selectinload(Person.devices))
                .where(Person.id == phone.person_id)
            )
            person_res = await db.execute(person_stmt)
            person = person_res.scalar_one_or_none()
            if person:
                result["person"] = person
                result["phone_numbers"] = person.phone_numbers
                result["devices"] = person.devices
                # Gather SIMs
                for pn in person.phone_numbers:
                    sim_stmt = select(SIM).where(SIM.phone_number_id == pn.id)
                    sim_res = await db.execute(sim_stmt)
                    result["sims"].extend(sim_res.scalars().all())
                result["confidence"] = 0.95
                return result

        # Try IMEI lookup
        dev_stmt = select(Device).where(Device.imei == identifier)
        dev_res = await db.execute(dev_stmt)
        device = dev_res.scalar_one_or_none()

        if device and device.person_id:
            person_stmt = (
                select(Person)
                .options(selectinload(Person.phone_numbers), selectinload(Person.devices))
                .where(Person.id == device.person_id)
            )
            person_res = await db.execute(person_stmt)
            person = person_res.scalar_one_or_none()
            if person:
                result["person"] = person
                result["phone_numbers"] = person.phone_numbers
                result["devices"] = person.devices
                result["confidence"] = 0.9
                return result

        # Try IMSI lookup
        sim_stmt = select(SIM).where(SIM.imsi == identifier)
        sim_res = await db.execute(sim_stmt)
        sim = sim_res.scalar_one_or_none()

        if sim and sim.phone_number_id:
            phone_stmt2 = select(PhoneNumber).where(PhoneNumber.id == sim.phone_number_id)
            phone_res2 = await db.execute(phone_stmt2)
            phone2 = phone_res2.scalar_one_or_none()
            if phone2 and phone2.person_id:
                person_stmt = (
                    select(Person)
                    .options(selectinload(Person.phone_numbers), selectinload(Person.devices))
                    .where(Person.id == phone2.person_id)
                )
                person_res = await db.execute(person_stmt)
                person = person_res.scalar_one_or_none()
                if person:
                    result["person"] = person
                    result["phone_numbers"] = person.phone_numbers
                    result["devices"] = person.devices
                    result["confidence"] = 0.85
                    return result

        # Partial match -- just return what we found
        if phone:
            result["phone_numbers"] = [phone]
            result["confidence"] = 0.5
        if device:
            result["devices"] = [device]
            result["confidence"] = max(result["confidence"], 0.5)
        if sim:
            result["sims"] = [sim]
            result["confidence"] = max(result["confidence"], 0.4)

        return result

    @staticmethod
    async def unified_search(db: AsyncSession, query: str, limit: int = 20) -> list[SearchResult]:
        """Search across persons, phones, devices, towers."""
        results: list[SearchResult] = []
        q = f"%{query}%"

        # Persons
        stmt = select(Person).where(Person.name.ilike(q)).limit(limit)
        res = await db.execute(stmt)
        for p in res.scalars().all():
            results.append(SearchResult(
                entity_type="person",
                entity_id=str(p.id),
                label=p.name,
                detail=p.nationality,
            ))

        # Phones
        stmt = select(PhoneNumber).where(PhoneNumber.msisdn.ilike(q)).limit(limit)
        res = await db.execute(stmt)
        for pn in res.scalars().all():
            results.append(SearchResult(
                entity_type="phone",
                entity_id=str(pn.id),
                label=pn.msisdn,
                detail=pn.carrier,
            ))

        # Devices
        stmt = select(Device).where(
            or_(Device.imei.ilike(q), Device.brand.ilike(q), Device.model.ilike(q))
        ).limit(limit)
        res = await db.execute(stmt)
        for d in res.scalars().all():
            results.append(SearchResult(
                entity_type="device",
                entity_id=str(d.id),
                label=d.imei,
                detail=f"{d.brand} {d.model}" if d.brand else None,
            ))

        # Towers
        stmt = select(Tower).where(
            or_(Tower.tower_id.ilike(q), Tower.address.ilike(q), Tower.city.ilike(q))
        ).limit(limit)
        res = await db.execute(stmt)
        for t in res.scalars().all():
            results.append(SearchResult(
                entity_type="tower",
                entity_id=str(t.id),
                label=t.tower_id,
                detail=t.address,
            ))

        return results[:limit]
