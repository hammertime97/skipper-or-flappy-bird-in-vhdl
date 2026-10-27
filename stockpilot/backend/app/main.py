"""StockPilot API."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routers import account, ai, inventory

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("stockpilot")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.jwt_secret == "dev-only-change-me":
        log.warning("JWT_SECRET is the development default. Set a long random value in production.")
    init_db()
    yield


app = FastAPI(title="StockPilot API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(account.router)
app.include_router(inventory.router)
app.include_router(ai.router)


@app.get("/health")
def health() -> dict:
    return {"ok": True}
