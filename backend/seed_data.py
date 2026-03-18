"""
Seed script for the TIAC database.
Run: python seed_data.py
Requires a running PostgreSQL with the tiac database already created.
"""

import asyncio
import random
import string
from datetime import datetime, timedelta, date, timezone

import bcrypt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import (
    engine, async_session_factory, Base,
    Person, PhoneNumber, Device, SIM, Tower,
    CallRecord, Message, LocationEvent, DataSession,
    Case, CaseEntity, CaseInsight, User, AnomalyAlert, AuditLog,
)

def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

# -------------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------------

_rng = random.Random(42)

INDIAN_FIRST = [
    "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Reyansh", "Mohammad", "Sai",
    "Arnav", "Dhruv", "Kabir", "Ritvik", "Ananya", "Diya", "Saanvi", "Myra",
    "Ishaan", "Shaurya", "Atharv", "Advait", "Kiara", "Aisha", "Priya", "Neha",
    "Ravi", "Suresh", "Manish", "Deepak", "Sunita", "Rekha", "Pooja", "Nisha",
    "Rahul", "Amit", "Vijay", "Raj", "Sanjay", "Kiran", "Anjali", "Meena",
    "Rohit", "Gaurav", "Nikhil", "Vikram", "Pankaj", "Harsh", "Yash", "Dev",
    "Preeti", "Sneha",
]
INDIAN_LAST = [
    "Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Shah", "Mehta",
    "Joshi", "Reddy", "Nair", "Iyer", "Rao", "Das", "Bose", "Mukherjee",
    "Chopra", "Malhotra", "Kapoor", "Agarwal", "Mishra", "Pandey", "Tiwari",
    "Saxena", "Srivastava",
]
CARRIERS = ["Jio", "Airtel", "Vi (Vodafone Idea)", "BSNL", "MTNL"]
DEVICE_BRANDS = [
    ("Samsung", ["Galaxy S23", "Galaxy A54", "Galaxy M34", "Galaxy S22", "Galaxy A14"]),
    ("Apple", ["iPhone 15", "iPhone 14", "iPhone 13", "iPhone SE 3"]),
    ("Xiaomi", ["Redmi Note 13", "Redmi 12", "Poco X5", "Mi 13"]),
    ("OnePlus", ["OnePlus 12", "OnePlus Nord CE 3", "OnePlus 11"]),
    ("Vivo", ["Vivo V29", "Vivo Y100", "Vivo X90"]),
    ("Realme", ["Realme 11 Pro", "Realme C55", "Realme GT Neo 5"]),
    ("Oppo", ["Oppo Reno 10", "Oppo A78", "Oppo Find X6"]),
]

# Mumbai area towers -- realistic coordinates
MUMBAI_AREAS = [
    ("Colaba", 18.9067, 72.8147),
    ("Churchgate", 18.9322, 72.8264),
    ("Marine Drive", 18.9432, 72.8235),
    ("CST", 18.9398, 72.8354),
    ("Dadar", 19.0178, 72.8478),
    ("Bandra", 19.0596, 72.8295),
    ("Andheri", 19.1136, 72.8697),
    ("Goregaon", 19.1663, 72.8526),
    ("Malad", 19.1874, 72.8484),
    ("Borivali", 19.2307, 72.8567),
    ("Thane", 19.2183, 72.9781),
    ("Navi Mumbai", 19.0330, 73.0297),
    ("Powai", 19.1176, 72.9060),
    ("Kurla", 19.0726, 72.8794),
    ("Chembur", 19.0522, 72.8850),
    ("Vashi", 19.0771, 72.9986),
    ("Airoli", 19.1559, 72.9982),
    ("Juhu", 19.0883, 72.8263),
    ("Worli", 19.0176, 72.8152),
    ("Lower Parel", 18.9926, 72.8311),
    ("Vikhroli", 19.1092, 72.9272),
    ("Mulund", 19.1726, 72.9561),
    ("Ghatkopar", 19.0860, 72.9080),
    ("Santacruz", 19.0813, 72.8371),
    ("Kandivali", 19.2094, 72.8526),
    ("Dahisar", 19.2502, 72.8625),
    ("Mira Road", 19.2813, 72.8686),
    ("Bhayander", 19.3012, 72.8513),
    ("Panvel", 18.9894, 73.1175),
    ("Belapur", 19.0235, 73.0385),
    ("Kharghar", 19.0474, 73.0603),
    ("Seawoods", 19.0220, 73.0183),
    ("Wadala", 19.0177, 72.8635),
    ("Sion", 19.0437, 72.8625),
    ("Matunga", 19.0275, 72.8521),
    ("Prabhadevi", 19.0096, 72.8286),
    ("Mahim", 19.0375, 72.8404),
    ("Versova", 19.1310, 72.8137),
    ("Oshiwara", 19.1391, 72.8366),
    ("Lokhandwala", 19.1406, 72.8302),
]

MSG_PREVIEWS = [
    "Meeting confirmed for tomorrow", "Can you send the report?", "Payment received",
    "Will be late today", "Check the delivery status", "Happy birthday!",
    "Order has been shipped", "Call me when free", "Invoice attached",
    "Where are you right now?", "Reached office", "On my way home",
    "Stock update needed", "New shipment arriving", "Price list updated",
    "Need to discuss urgently", "Transfer completed", "Account updated",
    "Schedule changed", "Please confirm the address",
    "Package delivered at drop point", "Meet at usual place 9pm",
    "Transfer completed ref TXN9834", "New SIM activated",
    "Change of plan - use backup number", "Shipment delayed to Thursday",
    "Account credited 50000", "Boss wants update by tonight",
    "Target moved to sector 5", "All clear proceed",
    None, None, None, None, None,  # Some messages without preview
]


def _rand_msisdn() -> str:
    return f"+919{_rng.randint(100000000, 999999999)}"


def _rand_imei() -> str:
    return "".join([str(_rng.randint(0, 9)) for _ in range(15)])


def _rand_imsi() -> str:
    return f"405{_rng.randint(10, 99)}{''.join(str(_rng.randint(0, 9)) for _ in range(10))}"


def _rand_iccid() -> str:
    return f"8991{_rng.randint(10, 99)}{''.join(str(_rng.randint(0, 9)) for _ in range(14))}"


def _rand_datetime(start: datetime, end: datetime) -> datetime:
    delta = end - start
    secs = int(delta.total_seconds())
    return start + timedelta(seconds=_rng.randint(0, secs))


# -------------------------------------------------------------------------
# Seed functions
# -------------------------------------------------------------------------

async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async with async_session_factory() as db:
        # --- Users ---
        users = [
            User(username="analyst1", password_hash=_hash("Analyst@Tiac#2026"), full_name="Priya Sharma", role="analyst", email="analyst1@tiac.local"),
            User(username="analyst2", password_hash=_hash("Analyst2@Sec!2026"), full_name="Sneha Reddy", role="analyst", email="analyst2@tiac.local"),
            User(username="supervisor1", password_hash=_hash("Sup3rvisor!Tiac#26"), full_name="Rajesh Kumar", role="supervisor", email="supervisor1@tiac.local"),
            User(username="admin", password_hash=_hash("Adm1n@Tiac$2026!"), full_name="System Admin", role="admin", email="admin@tiac.local"),
            User(username="auditor1", password_hash=_hash("Aud1t0r@Sec#2026"), full_name="Vikram Joshi", role="auditor", email="auditor1@tiac.local"),
        ]
        db.add_all(users)
        await db.flush()
        print(f"Created {len(users)} users")

        # --- Persons ---
        persons = []
        for i in range(50):
            first = _rng.choice(INDIAN_FIRST)
            last = _rng.choice(INDIAN_LAST)
            aliases_list = [f"{first[0]}. {last}"]
            if _rng.random() < 0.3:
                aliases_list.append(f"{first} {_rng.choice(INDIAN_LAST)}")
            p = Person(
                name=f"{first} {last}",
                aliases=aliases_list,
                nationality="Indian" if _rng.random() < 0.9 else _rng.choice(["Nepalese", "Bangladeshi", "Sri Lankan"]),
                date_of_birth=date(
                    _rng.randint(1960, 2002),
                    _rng.randint(1, 12),
                    _rng.randint(1, 28),
                ),
                risk_score=round(_rng.uniform(0, 1), 2),
                watchlist_status=_rng.random() < 0.1,
                notes=f"Person record #{i+1}" if _rng.random() < 0.3 else None,
            )
            persons.append(p)
        db.add_all(persons)
        await db.flush()
        print(f"Created {len(persons)} persons")

        # --- Phone numbers ---
        phones = []
        msisdns: list[str] = []
        for i in range(80):
            m = _rand_msisdn()
            while m in msisdns:
                m = _rand_msisdn()
            msisdns.append(m)
            pn = PhoneNumber(
                msisdn=m,
                person_id=persons[i % len(persons)].id if i < 60 else (_rng.choice(persons).id if _rng.random() < 0.5 else None),
                activation_date=date(_rng.randint(2019, 2025), _rng.randint(1, 12), _rng.randint(1, 28)),
                status=_rng.choice(["active", "active", "active", "inactive", "suspended"]),
                carrier=_rng.choice(CARRIERS),
            )
            phones.append(pn)
        db.add_all(phones)
        await db.flush()
        print(f"Created {len(phones)} phone numbers")

        # --- Devices ---
        devices = []
        imeis: list[str] = []
        for i in range(60):
            imei = _rand_imei()
            while imei in imeis:
                imei = _rand_imei()
            imeis.append(imei)
            brand, models = _rng.choice(DEVICE_BRANDS)
            d = Device(
                imei=imei,
                brand=brand,
                model=_rng.choice(models),
                person_id=persons[i % len(persons)].id if i < 50 else None,
            )
            devices.append(d)
        db.add_all(devices)
        await db.flush()
        print(f"Created {len(devices)} devices")

        # --- SIMs ---
        sims = []
        imsis: list[str] = []
        iccids: list[str] = []
        for i in range(100):
            imsi = _rand_imsi()
            while imsi in imsis:
                imsi = _rand_imsi()
            imsis.append(imsi)
            iccid = _rand_iccid()
            while iccid in iccids:
                iccid = _rand_iccid()
            iccids.append(iccid)
            s = SIM(
                imsi=imsi,
                iccid=iccid,
                phone_number_id=phones[i % len(phones)].id if i < 80 else None,
                device_id=devices[i % len(devices)].id if i < 60 else None,
                status=_rng.choice(["active", "active", "inactive"]),
            )
            sims.append(s)
        db.add_all(sims)
        await db.flush()
        print(f"Created {len(sims)} SIMs")

        # --- Towers ---
        towers = []
        for idx, (area, base_lat, base_lng) in enumerate(MUMBAI_AREAS):
            # Multiple towers per area
            count = _rng.randint(3, 7)
            for j in range(count):
                t = Tower(
                    tower_id=f"MUM-{area[:3].upper()}-{idx:03d}-{j:02d}",
                    latitude=base_lat + _rng.uniform(-0.005, 0.005),
                    longitude=base_lng + _rng.uniform(-0.005, 0.005),
                    azimuth=_rng.choice([0, 120, 240, 60, 180, 300]),
                    sector=j % 3 + 1,
                    address=f"Tower {j+1}, {area}",
                    city="Mumbai",
                    region="Maharashtra",
                    tower_type=_rng.choice(["macro", "macro", "micro", "pico"]),
                )
                towers.append(t)
                if len(towers) >= 200:
                    break
            if len(towers) >= 200:
                break
        db.add_all(towers)
        await db.flush()
        print(f"Created {len(towers)} towers")

        tower_ids = [t.id for t in towers]

        # --- Define interesting patterns ---
        # Organized network: 5 numbers that call each other frequently
        network_group = msisdns[:5]
        # Co-location pair
        coloc_pair = (msisdns[5], msisdns[6])
        coloc_towers = tower_ids[:3]  # They hang out around same towers
        # Burst contact number
        burst_msisdn = msisdns[7]
        # Impossible travel number
        travel_msisdn = msisdns[8]

        now = datetime.utcnow()
        start_date = now - timedelta(days=90)

        # --- Call Records ---
        print("Generating call records...")
        call_batch = []

        # Normal random calls
        for _ in range(15000):
            caller = _rng.choice(msisdns)
            callee = _rng.choice(msisdns)
            while callee == caller:
                callee = _rng.choice(msisdns)
            st = _rand_datetime(start_date, now)
            dur = _rng.randint(0, 1800) if _rng.random() < 0.8 else 0
            call_batch.append(CallRecord(
                caller_msisdn=caller,
                callee_msisdn=callee,
                caller_tower_id=_rng.choice(tower_ids),
                callee_tower_id=_rng.choice(tower_ids),
                start_time=st,
                end_time=st + timedelta(seconds=dur) if dur > 0 else None,
                duration_seconds=dur,
                call_type=_rng.choice(["voice", "voice", "voice", "video"]),
                status="answered" if dur > 0 else _rng.choice(["missed", "rejected"]),
            ))

        # Organized network calls (high frequency within group)
        for _ in range(3000):
            caller = _rng.choice(network_group)
            callee = _rng.choice(network_group)
            while callee == caller:
                callee = _rng.choice(network_group)
            st = _rand_datetime(start_date, now)
            dur = _rng.randint(30, 600)
            call_batch.append(CallRecord(
                caller_msisdn=caller,
                callee_msisdn=callee,
                caller_tower_id=_rng.choice(tower_ids),
                callee_tower_id=_rng.choice(tower_ids),
                start_time=st,
                end_time=st + timedelta(seconds=dur),
                duration_seconds=dur,
                call_type="voice",
                status="answered",
            ))

        # Burst: msisdns[7] suddenly calls many new numbers in last 5 days
        for _ in range(1000):
            callee = _rand_msisdn()  # New unknown numbers
            st = _rand_datetime(now - timedelta(days=5), now)
            dur = _rng.randint(10, 120)
            call_batch.append(CallRecord(
                caller_msisdn=burst_msisdn,
                callee_msisdn=callee,
                caller_tower_id=_rng.choice(tower_ids),
                callee_tower_id=_rng.choice(tower_ids),
                start_time=st,
                end_time=st + timedelta(seconds=dur),
                duration_seconds=dur,
                call_type="voice",
                status="answered",
            ))

        # Additional calls for key MSISDNs to enrich analytics
        for m in network_group + list(coloc_pair) + [burst_msisdn, travel_msisdn]:
            for _ in range(600):
                other = _rng.choice(msisdns)
                while other == m:
                    other = _rng.choice(msisdns)
                st = _rand_datetime(start_date, now)
                dur = _rng.randint(10, 900) if _rng.random() < 0.85 else 0
                call_batch.append(CallRecord(
                    caller_msisdn=m if _rng.random() < 0.5 else other,
                    callee_msisdn=other if _rng.random() < 0.5 else m,
                    caller_tower_id=_rng.choice(tower_ids),
                    callee_tower_id=_rng.choice(tower_ids),
                    start_time=st,
                    end_time=st + timedelta(seconds=dur) if dur > 0 else None,
                    duration_seconds=dur,
                    call_type=_rng.choice(["voice", "voice", "voice", "video"]),
                    status="answered" if dur > 0 else _rng.choice(["missed", "rejected"]),
                ))

        db.add_all(call_batch)
        await db.flush()
        print(f"Created {len(call_batch)} call records")

        # --- Messages ---
        print("Generating messages...")
        msg_batch = []

        for _ in range(8000):
            sender = _rng.choice(msisdns)
            receiver = _rng.choice(msisdns)
            while receiver == sender:
                receiver = _rng.choice(msisdns)
            msg_batch.append(Message(
                sender_msisdn=sender,
                receiver_msisdn=receiver,
                timestamp=_rand_datetime(start_date, now),
                message_type=_rng.choice(["sms", "sms", "sms", "mms", "chat"]),
                content_preview=_rng.choice(MSG_PREVIEWS),
                tower_id=_rng.choice(tower_ids),
            ))

        # Network group messages
        for _ in range(2000):
            sender = _rng.choice(network_group)
            receiver = _rng.choice(network_group)
            while receiver == sender:
                receiver = _rng.choice(network_group)
            msg_batch.append(Message(
                sender_msisdn=sender,
                receiver_msisdn=receiver,
                timestamp=_rand_datetime(start_date, now),
                message_type="sms",
                content_preview=_rng.choice(MSG_PREVIEWS),
                tower_id=_rng.choice(tower_ids),
            ))

        # Burst messages
        for _ in range(1000):
            receiver = _rand_msisdn()
            msg_batch.append(Message(
                sender_msisdn=burst_msisdn,
                receiver_msisdn=receiver,
                timestamp=_rand_datetime(now - timedelta(days=5), now),
                message_type="sms",
                content_preview=_rng.choice(MSG_PREVIEWS),
                tower_id=_rng.choice(tower_ids),
            ))

        # Additional messages for key MSISDNs
        for m in network_group + list(coloc_pair) + [burst_msisdn, travel_msisdn]:
            for _ in range(100):
                other = _rng.choice(msisdns)
                while other == m:
                    other = _rng.choice(msisdns)
                msg_batch.append(Message(
                    sender_msisdn=m if _rng.random() < 0.5 else other,
                    receiver_msisdn=other if _rng.random() < 0.5 else m,
                    timestamp=_rand_datetime(start_date, now),
                    message_type=_rng.choice(["sms", "sms", "mms", "chat"]),
                    content_preview=_rng.choice(MSG_PREVIEWS),
                    tower_id=_rng.choice(tower_ids),
                ))

        db.add_all(msg_batch)
        await db.flush()
        print(f"Created {len(msg_batch)} messages")

        # --- Location Events ---
        print("Generating location events...")
        loc_batch = []

        for _ in range(25000):
            m = _rng.choice(msisdns)
            ts = _rand_datetime(start_date, now)
            loc_batch.append(LocationEvent(
                msisdn=m,
                tower_id=_rng.choice(tower_ids),
                timestamp=ts,
                event_type=_rng.choice(["attach", "detach", "handover", "location_update", "location_update", "location_update"]),
                lac=_rng.randint(1000, 9999),
                cell_id=_rng.randint(10000, 99999),
                signal_strength=round(_rng.uniform(-110, -50), 1),
            ))

        # Co-location: both msisdns appear at same towers close in time
        for _ in range(1000):
            tower = _rng.choice(coloc_towers)
            base_time = _rand_datetime(start_date, now)
            for m in coloc_pair:
                loc_batch.append(LocationEvent(
                    msisdn=m,
                    tower_id=tower,
                    timestamp=base_time + timedelta(minutes=_rng.randint(0, 15)),
                    event_type="location_update",
                    lac=_rng.randint(1000, 9999),
                    cell_id=_rng.randint(10000, 99999),
                    signal_strength=round(_rng.uniform(-80, -50), 1),
                ))

        # Impossible travel: travel_msisdn appears at distant towers within minutes
        # Tower 0 is in south Mumbai, let us pick a far-north tower
        south_towers = tower_ids[:5]
        north_towers = tower_ids[-5:]
        for _ in range(25):
            base_time = _rand_datetime(start_date, now)
            loc_batch.append(LocationEvent(
                msisdn=travel_msisdn,
                tower_id=_rng.choice(south_towers),
                timestamp=base_time,
                event_type="location_update",
                lac=1001, cell_id=50001,
                signal_strength=-65.0,
            ))
            loc_batch.append(LocationEvent(
                msisdn=travel_msisdn,
                tower_id=_rng.choice(north_towers),
                timestamp=base_time + timedelta(minutes=_rng.randint(2, 5)),
                event_type="location_update",
                lac=9001, cell_id=90001,
                signal_strength=-70.0,
            ))

        # Additional location events for key MSISDNs so analytics has enough data
        for m in network_group + list(coloc_pair) + [burst_msisdn, travel_msisdn]:
            for _ in range(500):
                ts = _rand_datetime(start_date, now)
                loc_batch.append(LocationEvent(
                    msisdn=m,
                    tower_id=_rng.choice(tower_ids),
                    timestamp=ts,
                    event_type="location_update",
                    lac=_rng.randint(1000, 9999),
                    cell_id=_rng.randint(10000, 99999),
                    signal_strength=round(_rng.uniform(-100, -50), 1),
                ))

        db.add_all(loc_batch)
        await db.flush()
        print(f"Created {len(loc_batch)} location events")

        # --- Data Sessions ---
        print("Generating data sessions...")
        ds_batch = []
        for _ in range(8000):
            m = _rng.choice(msisdns)
            st = _rand_datetime(start_date, now)
            dur = _rng.randint(60, 7200)
            ds_batch.append(DataSession(
                msisdn=m,
                tower_id=_rng.choice(tower_ids),
                start_time=st,
                end_time=st + timedelta(seconds=dur),
                bytes_uploaded=_rng.randint(1024, 50_000_000),
                bytes_downloaded=_rng.randint(10240, 500_000_000),
            ))
        db.add_all(ds_batch)
        await db.flush()
        print(f"Created {len(ds_batch)} data sessions")

        # --- Cases ---
        cases = [
            Case(case_number="TIAC-2025-001", title="Organized Fraud Network Investigation",
                 description="Investigation of 5 numbers with high-frequency internal communication",
                 status="active", priority="critical", assigned_analyst_id=users[0].id, created_by_id=users[1].id),
            Case(case_number="TIAC-2025-002", title="SIM Swap Fraud Alert",
                 description="Suspicious SIM swaps detected in Andheri area",
                 status="active", priority="high", assigned_analyst_id=users[0].id, created_by_id=users[1].id),
            Case(case_number="TIAC-2025-003", title="Tower Dump Analysis - Robbery",
                 description="Tower dump for robbery incident near Bandra station",
                 status="open", priority="high", assigned_analyst_id=users[0].id, created_by_id=users[1].id),
            Case(case_number="TIAC-2024-015", title="Suspicious Call Pattern",
                 description="Number showing impossible travel pattern",
                 status="closed", priority="medium", assigned_analyst_id=users[0].id, created_by_id=users[1].id),
            Case(case_number="TIAC-2024-010", title="Bulk SMS Spam Operation",
                 description="Archived investigation of bulk SMS spam ring",
                 status="archived", priority="low", assigned_analyst_id=users[0].id, created_by_id=users[1].id),
        ]
        db.add_all(cases)
        await db.flush()
        print(f"Created {len(cases)} cases")

        # Add entities to cases
        for m in network_group:
            db.add(CaseEntity(case_id=cases[0].id, entity_type="phone", entity_id=m, notes="Part of network"))
        db.add(CaseEntity(case_id=cases[3].id, entity_type="phone", entity_id=travel_msisdn, notes="Impossible travel suspect"))
        db.add(CaseEntity(case_id=cases[1].id, entity_type="phone", entity_id=burst_msisdn, notes="Burst activity suspect"))
        for m in coloc_pair:
            db.add(CaseEntity(case_id=cases[2].id, entity_type="phone", entity_id=m, notes="Co-located pair"))
        await db.flush()

        # Add some insights
        insights = [
            CaseInsight(case_id=cases[0].id, insight_type="fact",
                        content="All 5 numbers show inter-communication frequency 10x above average",
                        confidence_score=0.95, created_by="analyst1"),
            CaseInsight(case_id=cases[0].id, insight_type="inference",
                        content="Network appears to be coordinating activities based on call timing patterns",
                        confidence_score=0.7, created_by="copilot"),
            CaseInsight(case_id=cases[3].id, insight_type="fact",
                        content="Target appeared at Colaba and Borivali towers within 3 minutes -- impossible travel",
                        confidence_score=0.99, created_by="analyst1"),
            CaseInsight(case_id=cases[1].id, insight_type="model_summary",
                        content="New contact burst: 500+ new unique contacts in last 5 days (normal baseline: ~5/week)",
                        confidence_score=0.85, created_by="copilot"),
        ]
        db.add_all(insights)
        await db.flush()
        print("Created case entities and insights")

        # --- Anomaly Alerts ---
        anomalies = [
            AnomalyAlert(msisdn=travel_msisdn, anomaly_type="impossible_travel",
                         description="Appeared at Colaba (south) and Borivali (north) towers within 3 minutes",
                         severity="critical"),
            AnomalyAlert(msisdn=burst_msisdn, anomaly_type="new_contact_burst",
                         description="1000+ new contacts in 5 days (baseline: ~5/week)",
                         severity="high"),
            AnomalyAlert(msisdn=network_group[0], anomaly_type="unusual_call_time",
                         description="Multiple calls between 1 AM and 4 AM over past week",
                         severity="medium"),
            AnomalyAlert(msisdn=network_group[1], anomaly_type="volume_spike",
                         description="Call volume 5x above 30-day average",
                         severity="medium"),
            AnomalyAlert(msisdn=coloc_pair[0], anomaly_type="persistent_colocation",
                         description=f"Consistently co-located with {coloc_pair[1]} at multiple towers",
                         severity="low"),
            AnomalyAlert(msisdn=network_group[2], anomaly_type="sim_swap",
                         description="SIM change detected -- new IMSI associated with existing MSISDN within 24 hours",
                         severity="high"),
            AnomalyAlert(msisdn=network_group[3], anomaly_type="tower_camping",
                         description="Stationary at single tower for 72+ hours continuously -- possible surveillance or stakeout",
                         severity="medium"),
            AnomalyAlert(msisdn=network_group[4], anomaly_type="encrypted_comms",
                         description="Shift to encrypted messaging apps detected; SMS/voice usage dropped to near zero",
                         severity="high"),
            AnomalyAlert(msisdn=coloc_pair[1], anomaly_type="device_sharing",
                         description="Multiple IMEIs observed for same MSISDN within short time window -- possible device sharing",
                         severity="medium"),
            AnomalyAlert(msisdn=travel_msisdn, anomaly_type="silent_period",
                         description="No network activity for 48 hours followed by sudden burst -- possible counter-surveillance",
                         severity="critical"),
        ]
        db.add_all(anomalies)
        await db.flush()
        print(f"Created {len(anomalies)} anomaly alerts")

        await db.commit()
        print("\n--- Seed complete ---")
        print(f"Key MSISDNs for testing:")
        print(f"  Organized network: {network_group}")
        print(f"  Co-location pair:  {coloc_pair}")
        print(f"  Burst contact:     {burst_msisdn}")
        print(f"  Impossible travel: {travel_msisdn}")
        print(f"\nLogin credentials:")
        print(f"  analyst1    / Analyst@Tiac#2026")
        print(f"  analyst2    / Analyst2@Sec!2026")
        print(f"  supervisor1 / Sup3rvisor!Tiac#26")
        print(f"  admin       / Adm1n@Tiac$2026!")
        print(f"  auditor1    / Aud1t0r@Sec#2026")


if __name__ == "__main__":
    asyncio.run(seed())
