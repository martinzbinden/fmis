"""APR600-Datenpool-Import für livestock (Mastplaner) — pull offline
aufgezeichneter Ohrmarken-Batches (z.B. von einem Transport) zum Anlegen/
Ergänzen einer Mastgruppe. Singleton-Router (livestock ist nicht instanziert,
siehe modules/dairy/backend/app/reader.py für das Factory-Pendant).

ACHTUNG: Das genaue Antwortformat von XGGROUPS/XGMEM wurde NICHT live am
Gerät bestätigt (anders als XGMEMINFO und das Live-Read-Frame) — die
Feldreihenfolge unten beruht auf den in AgriLink.exe gefundenen .NET-
Klassenfeldern (CMemoryGroup: GroupId/Name/CountExpected/CreationTimeStamp;
CTag2: TagNumber/Vid/NumberOfReads/FoundInLinklist), nicht auf einem
Mitschnitt. `raw` wird deshalb in jeder Antwort mitgeliefert, damit sich ein
falscher Feld-Split beim ersten Test am echten Gerät sofort erkennen lässt."""

from fastapi import APIRouter, Depends

from core.backend.fmis_core.agrident import ReaderBusyError, acquire_reader, sheep_short_tag
from core.backend.fmis_core.auth import CurrentUser, require_auth, require_permission
from core.backend.fmis_core.modules_admin import get_reader_settings, is_reader_enabled, require_reader_enabled

router = APIRouter()


@router.get("/reader/status")
async def status(user: CurrentUser = Depends(require_auth)) -> dict[str, bool]:
    return {"enabled": await is_reader_enabled("livestock")}


@router.get("/reader/datapools")
async def list_datapools(
    user: CurrentUser = Depends(require_permission("livestock:groups:read")),
    _reader_ok: CurrentUser = Depends(require_reader_enabled("livestock")),
) -> list[dict]:
    host, port = await get_reader_settings("livestock")
    try:
        async with acquire_reader(host, port) as conn:
            raw = await conn.send_command("XGGROUPS")
    except ReaderBusyError as exc:
        return [{"error": str(exc)}]

    groups = []
    for line in raw.strip("\r\n").split("\r\n"):
        if not line:
            continue
        fields = line.split("|")
        groups.append(
            {
                "group_id": fields[0] if len(fields) > 0 else None,
                "name": fields[1] if len(fields) > 1 else None,
                "count": int(fields[2]) if len(fields) > 2 and fields[2].isdigit() else None,
                "raw": line,
            }
        )
    return groups


@router.get("/reader/datapools/{group_id}")
async def get_datapool(
    group_id: str,
    user: CurrentUser = Depends(require_permission("livestock:groups:read")),
    _reader_ok: CurrentUser = Depends(require_reader_enabled("livestock")),
) -> list[dict]:
    host, port = await get_reader_settings("livestock")
    try:
        async with acquire_reader(host, port) as conn:
            raw = await conn.send_command("XGMEM", group_id)
    except ReaderBusyError as exc:
        return [{"error": str(exc)}]

    tags = []
    for line in raw.strip("\r\n").split("\r\n"):
        if not line:
            continue
        fields = line.split("|")
        long_tag = fields[0] if fields else None
        if not long_tag:
            continue
        tags.append({"ear_tag": sheep_short_tag(long_tag) or long_tag, "raw": line})
    return tags
