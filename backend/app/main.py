from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.backend.fmis_core import admin as core_admin
from core.backend.fmis_core import auth as core_auth
from core.backend.fmis_core import modules_admin
from core.backend.fmis_core.db import close_pools, get_pool, open_pools, run_migrations
from core.backend.fmis_core.module_registry import MODULE_SPECS
from core.backend.fmis_core.modules_admin import require_module_enabled
from modules.dairy.backend.app import reader as dairy_reader
from modules.dairy.backend.app import sync as dairy_sync
from modules.fields.backend.app import sync as fields_sync
from modules.livestock.backend.app import reader as livestock_reader
from modules.livestock.backend.app import sync as livestock_sync
from modules.wiesenjournal.backend.app import reports as wiesenjournal_reports
from modules.wiesenjournal.backend.app import sync as wiesenjournal_sync

# Zuordnung ModuleSpec.source -> Router-Factory (nimmt den Instanz-Key,
# gibt einen frischen APIRouter zurück). Keyed by SOURCE statt KEY, weil ein
# Modul mehrfach instanziert werden kann (siehe module_registry.py) — z.B.
# "dairy" für sowohl den Key "dairy" (Kühe) als auch "dairy_schafe" (Schafe).
# Module ohne eigene Factory (noch keine Instanzierung gebraucht) werden
# hier einfach auf ihren bisherigen Singleton-Router "zurückgebogen".
_MODULE_ROUTER_FACTORIES = {
    "livestock": lambda key: livestock_sync.router,
    "dairy": dairy_sync.build_router,
    "fields": lambda key: fields_sync.router,
    "wiesenjournal": lambda key: wiesenjournal_sync.router,
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
        _MODULE_ROUTER_FACTORIES[_spec.source](_spec.key),
        prefix=f"/{_spec.key}",
        dependencies=[Depends(require_module_enabled(_spec.key))],
    )
    # APR600-Leser (siehe core/backend/fmis_core/agrident.py): nur dairy-
    # Instanzen bekommen die Live-Melkliste; livestock ist nicht instanziert
    # und wird separat unten gemountet (Datenpool-Import, kein Loop nötig).
    if _spec.source == "dairy":
        app.include_router(
            dairy_reader.build_reader_router(_spec.key),
            prefix=f"/{_spec.key}",
            dependencies=[Depends(require_module_enabled(_spec.key))],
        )

# Zusätzliche Router, bewusst nicht Teil von _MODULE_ROUTERS/der Schleife
# oben (die von "ein Router pro Modul" ausgeht): wiesenjournal's
# Jahresauswertung (verschneidet gegen fields.field_declarations) und
# livestock's APR600-Datenpool-Import (Gruppen-Ohrmarken vom Leser).
app.include_router(
    wiesenjournal_reports.router,
    prefix="/wiesenjournal",
    dependencies=[Depends(require_module_enabled("wiesenjournal"))],
)
app.include_router(
    livestock_reader.router,
    prefix="/livestock",
    dependencies=[Depends(require_module_enabled("livestock"))],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
