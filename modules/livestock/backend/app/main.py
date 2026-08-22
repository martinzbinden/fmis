from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import admin, auth, sync
from .db import pool, run_migrations


@asynccontextmanager
async def lifespan(app: FastAPI):
    await pool.open()
    await run_migrations()
    yield
    await pool.close()


app = FastAPI(title="Mastplaner Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Einzelbetrieb-Tool, per Passwort geschützt; für LAN/PWA-Zugriff offen.
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(sync.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
