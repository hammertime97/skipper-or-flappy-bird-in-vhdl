"""Write every dummy sample file (as a seller would download them) into a folder.

    python scripts/write_samples.py ../docs/sample-data            # dated up to yesterday
    python scripts/write_samples.py ../docs/sample-data 2026-10-27 # fixed date, for the repo copy
"""

import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app import samples  # noqa: E402


def main() -> None:
    out = pathlib.Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    now = datetime.fromisoformat(sys.argv[2]).replace(tzinfo=timezone.utc) if len(sys.argv) > 2 else None
    for key in [*samples.STORES, "shopify-products"]:
        name, data = samples.build(key, now=now)
        (out / name).write_bytes(data)
        print(f"{name}  {len(data):,} bytes")
        if key in samples.STORES and key not in ("shopify", "spreadsheet"):
            name, data = samples.stock_csv(key)
            (out / name).write_bytes(data)
            print(f"{name}  {len(data):,} bytes")


if __name__ == "__main__":
    main()
