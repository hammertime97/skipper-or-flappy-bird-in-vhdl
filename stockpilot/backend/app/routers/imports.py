from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from .. import samples, services_import
from ..auth import current_user
from ..db import get_session
from ..guides import GUIDES
from ..importer import ROLE_LABELS, ImportError_
from ..models import User

router = APIRouter(prefix="/import")

MAX_UPLOAD = 25_000_000


class SheetOverride(BaseModel):
    index: int
    skip: bool = False
    kind: str | None = None  # "orders" | "stock"
    mapping: dict[str, str | None] = Field(default_factory=dict)  # role -> column heading ("" to clear)


class ConfirmIn(BaseModel):
    sheets: list[SheetOverride] = Field(default_factory=list)


def _bad(err: ImportError_) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, {"code": "import_error", "message": str(err)})


@router.get("/guides")
def guides() -> dict:
    """How to download a sales file from each platform, plus the column roles the app can read."""
    return {"guides": GUIDES, "roles": ROLE_LABELS}


@router.get("/samples")
def list_samples() -> list[dict]:
    return [
        {"key": s.key, "platform": s.platform, "title": s.title, "store_name": s.store_name, "filename": s.filename}
        for s in samples.STORES.values()
    ]


@router.get("/samples/{key}")
def download_sample(key: str) -> Response:
    try:
        filename, data = samples.build(key)
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such sample")
    media = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if filename.endswith(".xlsx") else "text/plain"
    )
    return Response(data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/samples/{key}/try")
def try_sample(key: str, user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    """Start an import with a dummy file, exactly as if the seller had uploaded it."""
    try:
        filename, data = samples.build(key)
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such sample")
    store = samples.STORES.get(key)
    if store and not user.niche:
        user.niche = store.niche
        session.add(user)
    try:
        return services_import.create_job(session, user, filename, data)
    except ImportError_ as err:
        raise _bad(err)


@router.post("/upload")
def upload(
    file: UploadFile = File(...), user: User = Depends(current_user), session: Session = Depends(get_session)
) -> dict:
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, {"code": "too_large", "message": "Files must be under 25 MB. Export a shorter date range."})
    try:
        return services_import.create_job(session, user, file.filename or "upload.csv", data)
    except ImportError_ as err:
        raise _bad(err)


@router.post("/{job_id}/confirm")
def confirm(
    job_id: int, body: ConfirmIn, user: User = Depends(current_user), session: Session = Depends(get_session)
) -> dict:
    try:
        return services_import.confirm_job(session, user, job_id, [s.model_dump() for s in body.sheets])
    except ImportError_ as err:
        raise _bad(err)
