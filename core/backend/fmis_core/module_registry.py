from dataclasses import dataclass
from pathlib import Path

# core/backend/fmis_core/module_registry.py -> repo root ist 3 Ebenen höher.
REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class ModuleSpec:
    key: str
    title: str
    schema_dir: Path
    # Welcher Code (Router-Factory, Frontend-Modul) diese Instanz betreibt.
    # Mehrere ModuleSpec-Einträge können dieselbe `source` teilen, um EIN
    # Modul (z.B. "dairy") mehrfach als unabhängige Instanz zu betreiben —
    # je eigenes Postgres-Schema, eigene pglite-DB, eigener Sync-Prefix,
    # eigene Rechte, aber derselbe Quellcode. Für nicht instanzierte Module
    # ist source == key.
    source: str


# Bewusst eine explizite Liste statt Verzeichnis-Scan unter modules/ — ein
# neues Modul hinzuzufügen ist ein Code-Change (ein Eintrag hier + Router-
# Import in backend/app/main.py), das AKTIVIEREN/DEAKTIVIEREN eines bereits
# registrierten Moduls dagegen ist zur Laufzeit über die `modules`-Tabelle
# steuerbar (siehe modules_admin.py) — kein Redeploy nötig.
MODULE_SPECS: list[ModuleSpec] = [
    ModuleSpec(key="livestock", source="livestock", title="Mastplaner", schema_dir=REPO_ROOT / "modules" / "livestock" / "schema"),
    ModuleSpec(key="dairy", source="dairy", title="Milchleistung", schema_dir=REPO_ROOT / "modules" / "dairy" / "schema"),
    ModuleSpec(key="dairy_schafe", source="dairy", title="Milchleistung Schafe", schema_dir=REPO_ROOT / "modules" / "dairy" / "schema"),
    ModuleSpec(key="fields", source="fields", title="Kulturen", schema_dir=REPO_ROOT / "modules" / "fields" / "schema"),
    ModuleSpec(key="wiesenjournal", source="wiesenjournal", title="Wiesenjournal", schema_dir=REPO_ROOT / "modules" / "wiesenjournal" / "schema"),
]
