from dataclasses import dataclass
from pathlib import Path

# core/backend/fmis_core/module_registry.py -> repo root ist 3 Ebenen höher.
REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class ModuleSpec:
    key: str
    title: str
    schema_dir: Path


# Bewusst eine explizite Liste statt Verzeichnis-Scan unter modules/ — ein
# neues Modul hinzuzufügen ist ein Code-Change (ein Eintrag hier + Router-
# Import in backend/app/main.py), das AKTIVIEREN/DEAKTIVIEREN eines bereits
# registrierten Moduls dagegen ist zur Laufzeit über die `modules`-Tabelle
# steuerbar (siehe modules_admin.py) — kein Redeploy nötig.
MODULE_SPECS: list[ModuleSpec] = [
    ModuleSpec(key="livestock", title="Mastplaner", schema_dir=REPO_ROOT / "modules" / "livestock" / "schema"),
    ModuleSpec(key="dairy", title="Milchleistung", schema_dir=REPO_ROOT / "modules" / "dairy" / "schema"),
    ModuleSpec(key="fields", title="Kulturen", schema_dir=REPO_ROOT / "modules" / "fields" / "schema"),
    ModuleSpec(key="wiesenjournal", title="Wiesenjournal", schema_dir=REPO_ROOT / "modules" / "wiesenjournal" / "schema"),
]
