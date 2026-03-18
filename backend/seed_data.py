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
    TowerRFProfile, TAMeasurement, CaptureHistory, CellRecommendation,
    OperationalPlaybook, PlaybookExecution,
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

CALL_TRANSCRIPTS = [
    "Discussed delivery schedule for next week. Confirmed warehouse location at Andheri.",
    "Brief check-in call. Subject confirmed arrival at location. Background noise suggests outdoor setting.",
    "Negotiation about pricing. Mentioned bulk quantity of 500 units. Payment terms discussed.",
    "Coordinating meeting point. Referenced landmark near Bandra station. Time set for 9 PM.",
    "Argument about delayed payment. Caller threatened consequences. Callee promised resolution by Friday.",
    "Discussing travel plans. Mentioned flight to Delhi on Thursday. Hotel booking confirmed.",
    "Financial discussion. Bank transfer of 2 lakh mentioned. Account number partially audible.",
    "Planning event logistics. Venue at Juhu confirmed. 50 people expected.",
    "Complaint about product quality. Replacement shipment demanded. Ref number QC-4521.",
    "Code words used: 'the package is ready', 'blue car at gate 3'. Short 45-second call.",
    "Routine family call. Discussed dinner plans and school pickup schedule.",
    "Business order placement. 200 units of item SKU-7834. Delivery to Goregaon warehouse.",
    "Subject mentioned changing phone number soon. Advised contact to use Signal app.",
    "Urgent tone. Discussed police presence at usual meeting spot. Suggested alternate location.",
    "Casual conversation. Cricket match discussion. Plans to watch at friend's place.",
    "Real estate inquiry. Property in Powai discussed. Price quoted at 1.5 crore.",
    "Medical appointment scheduling. Doctor visit at Hinduja Hospital tomorrow 10 AM.",
    "Discussed new SIM card activation. Mentioned Airtel store in Malad.",
    "Money collection call. Amount of 75000 confirmed. Drop location: Kurla station east exit.",
    "Logistics coordination. Truck arriving at 4 AM. Loading dock B. Driver contact shared.",
    "Encrypted reference: 'item 7 is in cold storage'. Followed by location coordinates.",
    "Job interview scheduled. TCS Powai campus. Round 2 technical. Wednesday 2 PM.",
    "Wedding planning discussion. Guest list of 300. Caterer confirmed. Budget 15 lakh.",
    "Vehicle purchase discussion. Second-hand Innova. Price 8.5 lakh. Registration pending.",
    "Insurance claim follow-up. Policy number LIC-982341. Claim amount 5 lakh.",
    None, None, None, None, None, None, None, None, None, None,  # ~40% calls without transcript
    None, None, None, None, None, None, None, None, None, None,
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
                transcript=_rng.choice(CALL_TRANSCRIPTS) if dur > 0 else None,
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
                transcript=_rng.choice(CALL_TRANSCRIPTS),
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
                transcript=_rng.choice(CALL_TRANSCRIPTS),
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

        # --- Operational Intelligence: RF Profiles ---
        print("Generating operational intelligence data...")
        rf_profiles = []
        freqs = [900, 1800, 2100, 2600]
        envs = ["urban", "urban", "urban", "suburban", "rural"]
        for t in towers:
            freq = _rng.choice(freqs)
            env = _rng.choice(envs)
            power = _rng.uniform(38, 46)
            height = _rng.uniform(15, 50)
            gain = _rng.uniform(12, 18)
            max_r = 1500 if env == "urban" else (3000 if env == "suburban" else 8000)
            rf_profiles.append(TowerRFProfile(
                tower_id=t.tower_id,
                frequency_mhz=freq,
                power_dbm=round(power, 1),
                antenna_height_m=round(height, 1),
                antenna_gain_dbi=round(gain, 1),
                environment=env,
                propagation_model="okumura_hata" if freq <= 1500 else "cost231_hata",
                max_range_m=max_r + _rng.uniform(-200, 200),
            ))
        db.add_all(rf_profiles)
        await db.flush()
        print(f"Created {len(rf_profiles)} RF profiles")

        # --- TA Measurements ---
        ta_measurements = []
        key_msisdns = network_group + list(coloc_pair) + [burst_msisdn, travel_msisdn]
        for m in key_msisdns[:10]:
            for _ in range(20):
                t = _rng.choice(towers)
                tech = _rng.choice(["GSM", "LTE"])
                ta_val = _rng.randint(0, 30) if tech == "GSM" else _rng.randint(0, 200)
                ta_measurements.append(TAMeasurement(
                    msisdn=m,
                    tower_id=t.tower_id,
                    ta_value=ta_val,
                    technology=tech,
                    ground_truth_lat=t.latitude + _rng.uniform(-0.003, 0.003) if _rng.random() < 0.3 else None,
                    ground_truth_lng=t.longitude + _rng.uniform(-0.003, 0.003) if _rng.random() < 0.3 else None,
                    measured_at=_rand_datetime(start_date, now),
                ))
        db.add_all(ta_measurements)
        await db.flush()
        print(f"Created {len(ta_measurements)} TA measurements")

        # --- Capture History ---
        methods = ["tower_dump", "targeted_cdr", "realtime_intercept", "location_track", "imsi_catcher"]
        times_of_day = ["morning", "afternoon", "evening", "night"]
        capture_histories = []
        for i in range(10):
            m = _rng.choice(key_msisdns)
            method = _rng.choice(methods)
            used_towers = [_rng.choice(towers).tower_id for _ in range(_rng.randint(1, 4))]
            success = _rng.random() < 0.6
            capture_histories.append(CaptureHistory(
                msisdn=m,
                method=method,
                cells_used=used_towers,
                success=success,
                duration_hours=round(_rng.uniform(0.5, 48), 1),
                time_of_day=_rng.choice(times_of_day),
                notes=f"Capture operation #{i+1}" if _rng.random() < 0.5 else None,
                case_id=cases[i % len(cases)].id if _rng.random() < 0.5 else None,
                analyst_id=users[0].id,
            ))
        db.add_all(capture_histories)
        await db.flush()
        print(f"Created {len(capture_histories)} capture histories")

        # --- Operational Playbooks ---
        playbooks = [
            OperationalPlaybook(
                name="Drug Network Dismantling",
                target_type="drug",
                description="Systematic approach to mapping and dismantling drug distribution networks using CDR analysis, tower monitoring, and coordinated surveillance.",
                steps=[
                    {"step_number": 1, "title": "Initial CDR Analysis", "description": "Pull 90-day CDR for target MSISDN. Identify top contacts and communication patterns.", "tool": "copilot", "estimated_minutes": 60, "required": True},
                    {"step_number": 2, "title": "Network Mapping", "description": "Map all 1st and 2nd degree contacts. Identify hub nodes and communication clusters.", "tool": "investigation", "estimated_minutes": 120, "required": True},
                    {"step_number": 3, "title": "Tower Pattern Analysis", "description": "Identify frequently used towers and movement corridors. Flag static meeting points.", "tool": "map", "estimated_minutes": 90, "required": True},
                    {"step_number": 4, "title": "Cell Monitoring Setup", "description": "Deploy monitoring on top 5 recommended cells based on target patterns.", "tool": "op-intel", "estimated_minutes": 60, "required": True},
                    {"step_number": 5, "title": "TA Precision Location", "description": "Use TA readings to pinpoint target location when active on monitored cells.", "tool": "op-intel", "estimated_minutes": 30, "required": False},
                    {"step_number": 6, "title": "Coordinated Action", "description": "Synchronize field team with real-time location data for interception.", "tool": "op-intel", "estimated_minutes": 120, "required": True},
                ],
                estimated_hours=8,
                success_rate=0.72,
            ),
            OperationalPlaybook(
                name="Financial Fraud Investigation",
                target_type="fraud",
                description="Investigate financial fraud operations using call/message patterns, identifying money mule networks and command chains.",
                steps=[
                    {"step_number": 1, "title": "Victim Call Analysis", "description": "Analyze victim's incoming calls 48h before fraud. Identify unknown callers.", "tool": "copilot", "estimated_minutes": 45, "required": True},
                    {"step_number": 2, "title": "Suspect Number Profiling", "description": "Profile each suspect number: registration details, activation date, usage patterns.", "tool": "entities", "estimated_minutes": 60, "required": True},
                    {"step_number": 3, "title": "SIM History Check", "description": "Check for SIM swaps, device changes, and carrier port-outs on suspect numbers.", "tool": "analytics", "estimated_minutes": 45, "required": True},
                    {"step_number": 4, "title": "Tower Correlation", "description": "Correlate suspect tower locations with bank branch and ATM locations.", "tool": "map", "estimated_minutes": 60, "required": True},
                    {"step_number": 5, "title": "Money Mule Mapping", "description": "Map downstream contacts receiving forwarded calls/messages. Identify mule chain.", "tool": "investigation", "estimated_minutes": 90, "required": True},
                ],
                estimated_hours=5,
                success_rate=0.68,
            ),
            OperationalPlaybook(
                name="Terror Cell Detection",
                target_type="terror",
                description="Detect and monitor potential terror cell communications using anomaly detection, encrypted comms patterns, and geographic analysis.",
                steps=[
                    {"step_number": 1, "title": "Anomaly Baseline", "description": "Establish communication baseline for target. Flag deviations from normal patterns.", "tool": "analytics", "estimated_minutes": 90, "required": True},
                    {"step_number": 2, "title": "Encrypted Comms Detection", "description": "Identify shifts to encrypted messaging (sudden SMS/voice drop with data usage spike).", "tool": "copilot", "estimated_minutes": 60, "required": True},
                    {"step_number": 3, "title": "Burner Phone Correlation", "description": "Identify potential burner phones by activation date, usage pattern, and tower overlap.", "tool": "investigation", "estimated_minutes": 120, "required": True},
                    {"step_number": 4, "title": "Geographic Pattern Analysis", "description": "Map movement patterns. Identify dead zones, meeting points, and border crossings.", "tool": "map", "estimated_minutes": 90, "required": True},
                    {"step_number": 5, "title": "Silent Period Monitoring", "description": "Flag and monitor silent periods (communication blackouts) which may precede operations.", "tool": "analytics", "estimated_minutes": 60, "required": True},
                    {"step_number": 6, "title": "Real-time Tracking", "description": "Deploy real-time TA-based tracking during active monitoring phase.", "tool": "op-intel", "estimated_minutes": 240, "required": True},
                ],
                estimated_hours=12,
                success_rate=0.55,
            ),
            OperationalPlaybook(
                name="Kidnapping Response",
                target_type="kidnap",
                description="Rapid response playbook for kidnapping cases. Focus on last known location, movement tracking, and ransom call tracing.",
                steps=[
                    {"step_number": 1, "title": "Last Known Location", "description": "Determine victim's last known cell tower and TA-based location.", "tool": "op-intel", "estimated_minutes": 15, "required": True},
                    {"step_number": 2, "title": "Movement Trail", "description": "Reconstruct movement trail from location events. Identify direction of travel.", "tool": "map", "estimated_minutes": 30, "required": True},
                    {"step_number": 3, "title": "Ransom Call Trace", "description": "If ransom call received, trace originating tower and TA location immediately.", "tool": "op-intel", "estimated_minutes": 10, "required": True},
                    {"step_number": 4, "title": "Vehicle Corridor Analysis", "description": "Map likely road corridors based on tower handover sequence.", "tool": "map", "estimated_minutes": 30, "required": True},
                    {"step_number": 5, "title": "Live Monitoring", "description": "Set up real-time monitoring on victim's number and all contact numbers.", "tool": "op-intel", "estimated_minutes": 15, "required": True},
                ],
                estimated_hours=2,
                success_rate=0.78,
            ),
            OperationalPlaybook(
                name="Organized Crime Network",
                target_type="organized_crime",
                description="Long-term investigation playbook for organized crime networks. Focus on hierarchy mapping, communication timing, and operational patterns.",
                steps=[
                    {"step_number": 1, "title": "Seed Number Analysis", "description": "Deep analysis of initial target number: 180-day CDR, all contacts, tower patterns.", "tool": "copilot", "estimated_minutes": 120, "required": True},
                    {"step_number": 2, "title": "Hierarchy Mapping", "description": "Map org structure from call patterns: frequency, direction, timing indicate rank.", "tool": "investigation", "estimated_minutes": 180, "required": True},
                    {"step_number": 3, "title": "Operational Window Detection", "description": "Identify when the network is most active. Late-night calls often indicate ops.", "tool": "analytics", "estimated_minutes": 60, "required": True},
                    {"step_number": 4, "title": "Safe House Identification", "description": "Find static locations where multiple network members converge regularly.", "tool": "map", "estimated_minutes": 90, "required": True},
                    {"step_number": 5, "title": "Cell Monitoring Deployment", "description": "Monitor towers around identified safe houses and operational corridors.", "tool": "op-intel", "estimated_minutes": 60, "required": True},
                    {"step_number": 6, "title": "Financial Trail", "description": "Correlate communication spikes with financial transaction patterns.", "tool": "investigation", "estimated_minutes": 120, "required": True},
                    {"step_number": 7, "title": "Takedown Planning", "description": "Use precision location and real-time tracking for coordinated takedown.", "tool": "op-intel", "estimated_minutes": 180, "required": True},
                ],
                estimated_hours=16,
                success_rate=0.62,
            ),
        ]
        db.add_all(playbooks)
        await db.flush()
        print(f"Created {len(playbooks)} operational playbooks")

        # --- Playbook Executions ---
        executions = []
        for i in range(4):
            pb = playbooks[i % len(playbooks)]
            m = _rng.choice(key_msisdns)
            steps = pb.steps or []
            # Mark some steps as completed
            progress = []
            completed_steps = _rng.randint(1, len(steps))
            for j, s in enumerate(steps):
                st = "completed" if j < completed_steps else ("in_progress" if j == completed_steps else "pending")
                progress.append({
                    "step_number": s.get("step_number", j + 1),
                    "title": s.get("title", f"Step {j + 1}"),
                    "status": st,
                    "notes": f"Completed by analyst" if st == "completed" else None,
                    "result": "Done" if st == "completed" else None,
                })

            is_complete = completed_steps >= len(steps)
            started = _rand_datetime(now - timedelta(days=30), now - timedelta(days=1))
            executions.append(PlaybookExecution(
                playbook_id=pb.id,
                msisdn=m,
                case_id=cases[i % len(cases)].id,
                status="completed" if is_complete else "active",
                step_progress=progress,
                started_at=started,
                completed_at=started + timedelta(hours=pb.estimated_hours) if is_complete else None,
                analyst_id=users[0].id,
                notes=f"Execution #{i+1}",
            ))
        db.add_all(executions)
        await db.flush()
        print(f"Created {len(executions)} playbook executions")

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
