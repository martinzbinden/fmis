"""Nährstoffrechnung je Düngungsmassnahme — Zwilling von
frontend/src/lib/nutrients.ts (keep in sync!). Menge × Gehalt je Einheit
der Düngerart; bei Gülle skaliert der Verdünnungsfaktor (Gülle-Anteil im
ausgebrachten Volumen) relativ zum Default der Düngerart: RGv-Werte gelten
für 1:1 (0.5) — wird 3:1 (0.75) ausgebracht, ist pro m³ 1.5× so viel drin.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any


def parse_dilution(text: str | None) -> float | None:
    """'3:1' (Gülle:Wasser) → 0.75; '1:1' → 0.5; None/unlesbar → None."""
    if not text:
        return None
    parts = text.replace(" ", "").split(":")
    if len(parts) != 2:
        return None
    try:
        a, b = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    return a / (a + b) if a + b > 0 else None


def _f(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, Decimal):
        return float(v)
    return float(v)


def compute_nutrients(amount: float | None, ftype: dict, dilution_factor: float | None) -> dict[str, float | None]:
    if amount is None:
        return {"n_kg": None, "n_avail_kg": None, "p2o5_kg": None, "k2o_kg": None}
    default = _f(ftype.get("dilution_default")) or 1.0
    scale = (dilution_factor / default) if dilution_factor else 1.0
    eff = amount * scale
    n_kg = eff * _f(ftype.get("n_kg_per_unit"))
    return {
        "n_kg": round(n_kg, 2),
        "n_avail_kg": round(n_kg * _f(ftype.get("n_avail_pct")) / 100.0, 2),
        "p2o5_kg": round(eff * _f(ftype.get("p2o5_kg_per_unit")), 2),
        "k2o_kg": round(eff * _f(ftype.get("k2o_kg_per_unit")), 2),
    }
