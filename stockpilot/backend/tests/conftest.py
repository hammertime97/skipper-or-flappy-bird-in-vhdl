import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256"
os.environ["REVENUECAT_WEBHOOK_SECRET"] = "rc-secret"
os.environ["FREE_AI_CALLS_PER_MONTH"] = "2"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


_counter = iter(range(10_000))


@pytest.fixture()
def auth(client):
    """Register a fresh user and return (headers, user json)."""
    email = f"seller{next(_counter)}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    body = r.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["user"]
