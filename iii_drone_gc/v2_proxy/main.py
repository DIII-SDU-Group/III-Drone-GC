"""Console entrypoint for iii-gc-proxy."""

from __future__ import annotations

import os

import uvicorn

from .app import create_app


def main() -> int:
    host = os.environ.get("III_GC_PROXY_HOST", "0.0.0.0")
    port = int(os.environ.get("III_GC_PROXY_PORT", "8780"))
    uvicorn.run(create_app(), host=host, port=port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
