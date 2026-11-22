"""Shop-Anfragen → Arbeiten (shop.py): welche Anfrage eine Arbeit auslöst und was darin steht. Erfundene Daten."""

from .shop import ref_line, task_fields

V_HOLZ = "11111111-0000-4000-8000-000000000001"
V_ANDERES = "11111111-0000-4000-8000-000000000002"


def _req(**extra):
    return {
        "id": "6f1c0e0e-0000-4000-8000-000000000001", "public_code": "K7M2QX", "status": "bestaetigt", "name": "Erika Muster",
        "phone": "079 000 00 00", "fulfillment": "lieferung", "address": "Musterweg 1\n3000 Bern", "customer_note": None,
        "due_date": "2026-12-20", "office_note": None,
        "lines": [{"variant_id": V_HOLZ, "label": "Brennholz Buche, Ster", "quantity": "3.000", "unit": "Ster"}], **extra,
    }


def test_nur_angekreuzte_produkte_loesen_arbeit_aus():
    assert task_fields(_req(), {V_ANDERES}) is None
    f = task_fields(_req(), {V_HOLZ})
    assert f["title"] == "Liefern: Brennholz Buche, Ster"
    assert f["area"] == "brennholz"
    assert f["due_date"] == "2026-12-20" and f["quantity"] == 3.0 and f["unit"] == "Ster"
    assert f["customer"] == "Erika Muster"
    assert f["notes"].split("\n")[0] == "Anfrage K7M2QX · Lieferung"


def test_abholung_und_verweis_ohne_personendaten():
    r = _req(fulfillment="abholung", address=None)
    assert task_fields(r, {V_HOLZ})["title"].startswith("Bereitstellen")
    assert ref_line(r) == "Anfrage K7M2QX · Abholung"
    assert "Muster" not in ref_line(r)
