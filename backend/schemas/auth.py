from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    email: Optional[str] = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: Optional[UserResponse] = None


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6)
    full_name: str = Field(min_length=1, max_length=256)
    role: str = Field(default="analyst", pattern=r"^(analyst|supervisor|admin|auditor)$")
    email: Optional[str] = None


class UserInToken(BaseModel):
    id: int
    username: str
    role: str
