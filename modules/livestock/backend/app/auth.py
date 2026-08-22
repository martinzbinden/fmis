import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

APP_PASSWORD = os.environ.get("APP_PASSWORD", "changeme")
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_DAYS = 30

router = APIRouter()
bearer_scheme = HTTPBearer()


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/auth/login", response_model=LoginResponse)
def login(body: LoginRequest) -> LoginResponse:
    if body.password != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Falsches Passwort")
    expire = datetime.now(timezone.utc) + timedelta(days=TOKEN_TTL_DAYS)
    token = jwt.encode({"sub": "farm", "exp": expire}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return LoginResponse(access_token=token)


def require_auth(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> None:
    try:
        jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Ungültiges oder abgelaufenes Token")
