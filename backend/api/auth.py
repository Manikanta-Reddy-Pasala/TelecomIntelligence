from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
import bcrypt
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from models.database import User
from schemas.auth import LoginRequest, TokenResponse, UserCreate, UserResponse
from api.deps import DB, CurrentUser, require_roles

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def _create_token(user_id: int, role: str) -> tuple[str, int]:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "role": role, "exp": expire}
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return token, ACCESS_TOKEN_EXPIRE_MINUTES * 60


async def _authenticate_and_respond(username: str, password: str, db: AsyncSession) -> TokenResponse:
    """Shared authentication logic for both form-based and JSON-based login."""
    stmt = select(User).where(User.username == username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not _verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    token, expires_in = _create_token(user.id, user.role)
    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: DB):
    """Login with JSON body (username + password)."""
    return await _authenticate_and_respond(payload.username, payload.password, db)


@router.post("/login/form", response_model=TokenResponse)
async def login_form(form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DB):
    """Login with OAuth2 form data (for Swagger UI / OAuth2 compatibility)."""
    return await _authenticate_and_respond(form.username, form.password, db)


@router.get("/me", response_model=UserResponse)
async def get_me(user: CurrentUser):
    return user


@router.post("/users", response_model=UserResponse, status_code=201)
async def create_user(
    payload: UserCreate,
    db: DB,
    admin: Annotated[User, Depends(require_roles("admin"))],
):
    # Check uniqueness
    stmt = select(User).where(User.username == payload.username)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")

    user = User(
        username=payload.username,
        password_hash=_hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
        email=payload.email,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user
