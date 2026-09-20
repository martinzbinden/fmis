from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.backend.fmis_core import admin as core_admin
from core.backend.fmis_core import auth as core_auth
from core.backend.fmis_core import modules_admin
from core.backend.fmis_core.db import close_pools, get_pool, open_pools, run_migrations
from core.backend.fmis_core.module_registry import MODULE_SPECS
from core.backend.fmis_core.modules_admin import require_module_enabled
from modules.dairy.backend.app import sync as dairy_sync
from modules.fields.backend.app import sync as fields_sync
from modules.livestock.backend.app import sync as livestock_sync
from modules.wiesenjournal.backend.app import reports as wiesenjournal_reports
from modules.wiesenjournal.backend.app import sync as wiesenjournal_sync

# Explizite Zuordnung Modul-Key -> dessen (unveränderter) Sync-Router, siehe
# core/backend/fmis_core/module_registry.py für die Begründung "Liste statt
# Verzeichnis-Scan".
_MODULE_ROUTERS = {
    "livestock": livestock_sync.router,
    "dairy": dairy_sync.router,
    "fields": fields_sync.router,
    "wiesenjournal": wiesenjournal_sync.router,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pools für 'public' + jedes Modul vorab registrieren, damit open_pools()
    # sie alle findet — die Sync-Router selbst rufen get_pool(key) bereits
    # beim Import auf (siehe modules/*/backend/app/sync.py), das hier stellt
    # zusätzlich sicher, dass auch 'public' offen ist, bevor run_migrations()
    # läuft.
    get_pool("public")
    for spec in MODULE_SPECS:
        get_pool(spec.key)
    await open_pools()
    await run_migrations()
    yield
    await close_pools()


app = FastAPI(title="FMIS Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Familienbetrieb-Tool, per Login geschützt; für LAN/PWA-Zugriff offen.
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(core_auth.router)
app.include_router(core_admin.router)
app.include_router(modules_admin.router)

for _spec in MODULE_SPECS:
    app.include_router(
        _MODULE_ROUTERS[_spec.key],
        prefix=f"/{_spec.key}",
        dependencies=[Depends(require_module_enabled(_spec.key))],
    )

# Zusätzlicher Router NUR für wiesenjournal (Jahresauswertung, verschneidet
# gegen fields.field_declarations) — bewusst nicht Teil von _MODULE_ROUTERS,
# das schema-weit von "ein Router pro Modul" ausgeht; ein zweiter, expliziter
# include_router hier ändert an der generischen Schleife oben nichts.
app.include_router(
    wiesenjournal_reports.router,
    prefix="/wiesenjournal",
    dependencies=[Depends(require_module_enabled("wiesenjournal"))],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
