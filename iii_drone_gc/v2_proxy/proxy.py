"""Selected-runtime HTTP and WebSocket proxy transports."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import WebSocket


HOP_BY_HOP_HEADERS = {
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


@dataclass(frozen=True)
class ProxyHttpResponse:
    status_code: int
    headers: dict[str, str]
    content: bytes


class ProxyHttpClient(Protocol):
    async def request(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str],
        content: bytes,
    ) -> ProxyHttpResponse:
        ...


class HttpxProxyHttpClient:
    def __init__(self, *, timeout_s: float = 10.0):
        self.timeout_s = timeout_s

    async def request(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str],
        content: bytes,
    ) -> ProxyHttpResponse:
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            response = await client.request(method, url, headers=headers, content=content)
        return ProxyHttpResponse(
            status_code=response.status_code,
            headers=_filtered_headers(response.headers),
            content=response.content,
        )


class WebSocketProxyTransport(Protocol):
    async def bridge(self, *, downstream: WebSocket, upstream_url: str, headers: dict[str, str]) -> None:
        ...


class WebsocketsProxyTransport:
    async def bridge(self, *, downstream: WebSocket, upstream_url: str, headers: dict[str, str]) -> None:
        try:
            import websockets
        except Exception as exc:
            await downstream.close(code=1011, reason=f"websocket proxy transport unavailable: {exc}")
            return

        try:
            upstream = await websockets.connect(upstream_url, additional_headers=headers)
        except Exception as exc:
            await downstream.close(code=1011, reason=f"upstream websocket unavailable: {exc}")
            return

        await downstream.accept()
        async with upstream:
            async def downstream_to_upstream() -> None:
                while True:
                    message = await downstream.receive()
                    if "text" in message and message["text"] is not None:
                        await upstream.send(message["text"])
                    elif "bytes" in message and message["bytes"] is not None:
                        await upstream.send(message["bytes"])
                    else:
                        break

            async def upstream_to_downstream() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await downstream.send_bytes(message)
                    else:
                        await downstream.send_text(str(message))

            done, pending = await asyncio.wait(
                {
                    asyncio.create_task(downstream_to_upstream()),
                    asyncio.create_task(upstream_to_downstream()),
                },
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                task.result()


def build_upstream_http_url(base_url: str, path: str, query_string: str = "") -> str:
    relative_path = path.lstrip("/")
    parsed_path = urlsplit(relative_path)
    if parsed_path.scheme or parsed_path.netloc:
        raise ValueError("proxy path must be relative to the selected runtime")
    url = urljoin(f"{base_url.rstrip('/')}/", relative_path)
    if query_string:
        url = f"{url}?{query_string}"
    return url


def build_upstream_ws_url(base_url: str, path: str, query_string: str = "") -> str:
    http_url = build_upstream_http_url(base_url, path, query_string)
    if http_url.startswith("https://"):
        return f"wss://{http_url[len('https://'):]}"
    if http_url.startswith("http://"):
        return f"ws://{http_url[len('http://'):]}"
    return http_url


def filtered_request_headers(headers) -> dict[str, str]:
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS and not key.lower().startswith("sec-websocket-")
    }


def _filtered_headers(headers) -> dict[str, str]:
    return {
        key: value
        for key, value in dict(headers).items()
        if key.lower() not in HOP_BY_HOP_HEADERS
    }
