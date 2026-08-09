from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import os
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

# Disable upstream anonymous telemetry before importing Graphiti. This runtime
# may call OpenRouter for authorized graph operations but must not emit separate
# product telemetry or resolve dependencies at runtime.
os.environ["GRAPHITI_TELEMETRY_ENABLED"] = "false"
os.environ.pop("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", None)
os.environ.pop("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", None)

from graphiti_core import Graphiti  # noqa: E402
from graphiti_core.nodes import EpisodeType  # noqa: E402
from graphiti_core.llm_client.config import LLMConfig  # noqa: E402
from graphiti_core.llm_client.openai_client import OpenAIClient  # noqa: E402
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig  # noqa: E402
from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient  # noqa: E402

EXPECTED_GRAPHITI_VERSION = "0.29.3"
EXPECTED_GRAPHITI_COMMIT = "021d3a57d511f21b10adaf7fa923bd5c1fce5e9d"
LISTEN_HOST = "127.0.0.1"
LOOPBACK_TOKEN_HEADER = "x-yance-graphiti-token"
LOOPBACK_CHALLENGE_HEADER = "x-yance-graphiti-challenge"
LOOPBACK_HEALTH_PATH = "/yance/healthz"
LOOPBACK_PROOF_DOMAIN = "yance-graphiti-health-v1:"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def clean(value: Any) -> str:
    return str(value or "").strip()


def require_env(name: str) -> str:
    value = clean(os.environ.get(name))
    if not value:
        raise RuntimeError(f"YANCE_GRAPHITI_ENV_REQUIRED:{name}")
    return value


def required_loopback_token() -> str:
    token = require_env("YANCE_GRAPHITI_LOOPBACK_TOKEN")
    if not 43 <= len(token) <= 128 or any(ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for ch in token):
        raise RuntimeError("YANCE_GRAPHITI_LOOPBACK_TOKEN_INVALID")
    return token


def relationship_group_id(contact_id: str) -> str:
    contact = clean(contact_id)
    if not contact or len(contact) > 512:
        raise ValueError("YANCE_GRAPHITI_CONTACT_ID_INVALID")
    return "yance-rel-" + hashlib.sha256(contact.encode("utf-8")).hexdigest()


def parse_reference_time(value: Any) -> datetime:
    raw = clean(value)
    if not raw:
        return datetime.now(timezone.utc)
    normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return clean(value) or None


def deterministic_episode_uuid(group_id: str, external_message_id: str, body: str, reference_time: datetime) -> str:
    stable = external_message_id or hashlib.sha256(f"{reference_time.isoformat()}\n{body}".encode("utf-8")).hexdigest()
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"yance-graphiti:{group_id}:{stable}"))


def health_instance_proof(token: str, challenge: str) -> str:
    return hmac.new(token.encode("utf-8"), f"{LOOPBACK_PROOF_DOMAIN}{challenge}".encode("utf-8"), hashlib.sha256).hexdigest()


def edge_projection(edge: Any, fallback_episode_uuid: str = "") -> dict[str, Any]:
    episodes = [clean(value) for value in list(getattr(edge, "episodes", []) or []) if clean(value)]
    episode_uuid = episodes[-1] if episodes else clean(fallback_episode_uuid)
    return {
        "factId": clean(getattr(edge, "uuid", "")),
        "episodeUuid": episode_uuid,
        "groupId": clean(getattr(edge, "group_id", "")),
        "name": clean(getattr(edge, "name", "")),
        "fact": clean(getattr(edge, "fact", "")),
        "validAt": iso(getattr(edge, "valid_at", None)),
        "invalidAt": iso(getattr(edge, "invalid_at", None)),
        "referenceTime": iso(getattr(edge, "reference_time", None)),
        "createdAt": iso(getattr(edge, "created_at", None)),
        "episodeUuids": episodes,
    }


@dataclass
class RuntimeContext:
    graphiti: Graphiti | None = None
    locks: dict[str, asyncio.Lock] = field(default_factory=dict)

    def lock_for(self, group_id: str) -> asyncio.Lock:
        if group_id not in self.locks:
            self.locks[group_id] = asyncio.Lock()
        return self.locks[group_id]


RUNTIME = RuntimeContext()


def build_graphiti() -> Graphiti:
    key = require_env("OPENROUTER_API_KEY")
    base_url = clean(os.environ.get("YANCE_GRAPHITI_OPENROUTER_BASE_URL")) or OPENROUTER_BASE_URL
    if base_url != OPENROUTER_BASE_URL:
        raise RuntimeError("YANCE_GRAPHITI_OPENROUTER_BASE_URL_INVALID")
    llm_config = LLMConfig(
        api_key=key,
        model=require_env("YANCE_GRAPHITI_CHAT_MODEL"),
        small_model=require_env("YANCE_GRAPHITI_SMALL_MODEL"),
        base_url=base_url,
    )
    reranker_config = LLMConfig(
        api_key=key,
        model=require_env("YANCE_GRAPHITI_RERANKER_MODEL"),
        small_model=require_env("YANCE_GRAPHITI_RERANKER_MODEL"),
        base_url=base_url,
    )
    embedder_config = OpenAIEmbedderConfig(
        api_key=key,
        embedding_model=require_env("YANCE_GRAPHITI_EMBEDDING_MODEL"),
        base_url=base_url,
    )
    return Graphiti(
        uri=require_env("YANCE_GRAPHITI_NEO4J_URI"),
        user="neo4j",
        password=require_env("YANCE_GRAPHITI_NEO4J_PASSWORD"),
        llm_client=OpenAIClient(llm_config),
        embedder=OpenAIEmbedder(embedder_config),
        cross_encoder=OpenAIRerankerClient(reranker_config),
    )


async def initialize_runtime() -> None:
    RUNTIME.graphiti = build_graphiti()
    await RUNTIME.graphiti.driver.health_check()
    await RUNTIME.graphiti.build_indices_and_constraints()


async def shutdown_runtime() -> None:
    graphiti = RUNTIME.graphiti
    RUNTIME.graphiti = None
    if graphiti is not None:
        await graphiti.close()


async def add_episode(payload: dict[str, Any], route_group_id: str) -> dict[str, Any]:
    if RUNTIME.graphiti is None:
        raise RuntimeError("YANCE_GRAPHITI_RUNTIME_NOT_INITIALIZED")
    contact_id = clean(payload.get("contactId"))
    group_id = relationship_group_id(contact_id)
    if route_group_id != group_id:
        raise ValueError("YANCE_GRAPHITI_RELATIONSHIP_SCOPE_MISMATCH")
    episode_body = clean(payload.get("episodeBody"))
    if not episode_body or len(episode_body) > 50000:
        raise ValueError("YANCE_GRAPHITI_EPISODE_INVALID")
    reference_time = parse_reference_time(payload.get("referenceTime"))
    external_message_id = clean(payload.get("externalMessageId"))[:512]
    episode_uuid = deterministic_episode_uuid(group_id, external_message_id, episode_body, reference_time)
    async with RUNTIME.lock_for(group_id):
        result = await RUNTIME.graphiti.add_episode(
            name=clean(payload.get("name"))[:512] or f"Yance relationship episode {episode_uuid}",
            episode_body=episode_body,
            source_description=clean(payload.get("sourceDescription"))[:512] or "Yance relationship conversation event",
            reference_time=reference_time,
            source=EpisodeType.message,
            group_id=group_id,
            uuid=episode_uuid,
        )
    facts = [edge_projection(edge, result.episode.uuid) for edge in result.edges]
    return {
        "ok": True,
        "groupId": group_id,
        "episodeUuid": result.episode.uuid,
        "referenceTime": iso(result.episode.valid_at),
        "facts": facts,
    }


async def search_facts(payload: dict[str, Any], route_group_id: str) -> dict[str, Any]:
    if RUNTIME.graphiti is None:
        raise RuntimeError("YANCE_GRAPHITI_RUNTIME_NOT_INITIALIZED")
    contact_id = clean(payload.get("contactId"))
    group_id = relationship_group_id(contact_id)
    if route_group_id != group_id:
        raise ValueError("YANCE_GRAPHITI_RELATIONSHIP_SCOPE_MISMATCH")
    query = clean(payload.get("query"))
    if not query or len(query) > 20000:
        raise ValueError("YANCE_GRAPHITI_QUERY_INVALID")
    limit = max(1, min(50, int(payload.get("limit") or 12)))
    edges = await RUNTIME.graphiti.search(query, group_ids=[group_id], num_results=limit)
    return {"ok": True, "groupId": group_id, "facts": [edge_projection(edge) for edge in edges]}


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], handler: type[BaseHTTPRequestHandler], loop: asyncio.AbstractEventLoop, token: str):
        super().__init__(address, handler)
        self.runtime_loop = loop
        self.loopback_token = token


class Handler(BaseHTTPRequestHandler):
    server_version = "YanceGraphitiBridge/1"
    sys_version = ""

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(encoded)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > 1_000_000:
            raise ValueError("YANCE_GRAPHITI_REQUEST_BODY_INVALID")
        value = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("YANCE_GRAPHITI_REQUEST_BODY_INVALID")
        return value

    def require_auth(self) -> bool:
        supplied = clean(self.headers.get(LOOPBACK_TOKEN_HEADER))
        if not hmac.compare_digest(supplied, self.server.loopback_token):  # type: ignore[attr-defined]
            self.send_json(403, {"ok": False, "reasonCode": "YANCE_GRAPHITI_LOOPBACK_AUTH_REQUIRED", "message": "authenticated Yance loopback transport is required"})
            return False
        return True

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != LOOPBACK_HEALTH_PATH:
            self.send_json(404, {"ok": False, "reasonCode": "YANCE_GRAPHITI_ROUTE_NOT_FOUND"})
            return
        challenge = clean(self.headers.get(LOOPBACK_CHALLENGE_HEADER))
        if not 16 <= len(challenge) <= 256 or any(ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for ch in challenge):
            self.send_json(422, {"ok": False, "reasonCode": "YANCE_GRAPHITI_HEALTH_CHALLENGE_INVALID"})
            return
        self.send_json(200, {"ok": True, "graphitiVersion": EXPECTED_GRAPHITI_VERSION, "graphitiCommit": EXPECTED_GRAPHITI_COMMIT, "instanceProof": health_instance_proof(self.server.loopback_token, challenge)})  # type: ignore[attr-defined]

    def do_POST(self) -> None:  # noqa: N802
        if not self.require_auth():
            return
        try:
            path = urlparse(self.path).path
            parts = [part for part in path.split("/") if part]
            if len(parts) != 4 or parts[:2] != ["yance", "relationships"] or parts[3] not in {"episodes", "search"}:
                self.send_json(404, {"ok": False, "reasonCode": "YANCE_GRAPHITI_ROUTE_NOT_FOUND"})
                return
            group_id = parts[2]
            payload = self.read_json()
            coro = add_episode(payload, group_id) if parts[3] == "episodes" else search_facts(payload, group_id)
            future = asyncio.run_coroutine_threadsafe(coro, self.server.runtime_loop)  # type: ignore[attr-defined]
            self.send_json(200, future.result(timeout=120))
        except ValueError as error:
            self.send_json(422, {"ok": False, "reasonCode": clean(error) or "YANCE_GRAPHITI_INPUT_INVALID"})
        except TimeoutError:
            self.send_json(504, {"ok": False, "reasonCode": "YANCE_GRAPHITI_OPERATION_TIMEOUT"})
        except Exception as error:
            # Never include provider credentials, prompts, or raw model errors in loopback responses.
            self.send_json(503, {"ok": False, "reasonCode": "YANCE_GRAPHITI_OPERATION_FAILED", "message": type(error).__name__})


def self_test() -> int:
    assert relationship_group_id("contact-A") == relationship_group_id("contact-A")
    assert relationship_group_id("contact-A") != relationship_group_id("contact-B")
    assert parse_reference_time("2026-08-08T12:00:00Z").tzinfo is not None
    assert deterministic_episode_uuid("yance-rel-test", "m1", "hello", parse_reference_time("2026-08-08T12:00:00Z")) == deterministic_episode_uuid("yance-rel-test", "m1", "different", parse_reference_time("2026-08-09T12:00:00Z"))
    return 0


async def run_server(host: str, port: int) -> None:
    if host != LISTEN_HOST:
        raise RuntimeError("YANCE_GRAPHITI_NON_LOOPBACK_BIND_DENIED")
    token = required_loopback_token()
    await initialize_runtime()
    loop = asyncio.get_running_loop()
    server = BridgeServer((host, port), Handler, loop, token)
    thread = threading.Thread(target=server.serve_forever, name="yance-graphiti-http", daemon=True)
    thread.start()
    try:
        while thread.is_alive():
            await asyncio.sleep(0.5)
    finally:
        server.shutdown()
        server.server_close()
        await shutdown_runtime()


def main() -> int:
    parser = argparse.ArgumentParser(description="Yance thin authenticated bridge to the sealed Graphiti runtime")
    parser.add_argument("--host", default=LISTEN_HOST)
    parser.add_argument("--port", type=int, default=18766)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    asyncio.run(run_server(args.host, args.port))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
