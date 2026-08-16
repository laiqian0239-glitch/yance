from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Privacy defaults must be set before any Parlant module is imported.
os.environ["PARLANT_DATA_COLLECTION"] = "false"
os.environ.pop("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", None)
os.environ.pop("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", None)

RUNTIME_ROOT = Path(__file__).resolve().parent
TIKTOKEN_CACHE_KEY = "fb374d419588a4632f3f557e76b4b70aebbca790"
TIKTOKEN_ENCODING_SHA256 = "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d"
TIKTOKEN_CACHE_DIR = (RUNTIME_ROOT / "tiktoken-cache").resolve()
os.environ["TIKTOKEN_CACHE_DIR"] = str(TIKTOKEN_CACHE_DIR)


def _assert_sealed_tiktoken_cache() -> None:
    cache_file = TIKTOKEN_CACHE_DIR / TIKTOKEN_CACHE_KEY
    if not cache_file.is_file():
        raise RuntimeError(f"YANCE_PARLANT_TIKTOKEN_CACHE_MISSING: {cache_file}")
    actual = hashlib.sha256(cache_file.read_bytes()).hexdigest()
    if actual != TIKTOKEN_ENCODING_SHA256:
        raise RuntimeError(
            f"YANCE_PARLANT_TIKTOKEN_CACHE_HASH_MISMATCH: expected={TIKTOKEN_ENCODING_SHA256} actual={actual}"
        )


_assert_sealed_tiktoken_cache()

DATA_ROOT = Path(os.environ.get("YANCE_PARLANT_DATA_ROOT") or os.environ.get("PARLANT_HOME") or "parlant-data").resolve()
DATA_ROOT.mkdir(parents=True, exist_ok=True)
os.environ["PARLANT_HOME"] = str(DATA_ROOT)

from fastapi import Body, FastAPI, HTTPException, Query, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.routing import APIWebSocketRoute  # noqa: E402
from lagom import Container  # noqa: E402
from parlant.adapters.nlp.openrouter_service import OpenRouterService  # noqa: E402
from parlant.bin.server import StartupParameters, start_parlant  # noqa: E402
from parlant.core.agents import AgentId  # noqa: E402
from parlant.core.application import Application  # noqa: E402
from parlant.core.common import ItemNotFoundError  # noqa: E402
from parlant.core.customers import CustomerId  # noqa: E402
from parlant.core.evaluations import JourneyPayload, PayloadOperation  # noqa: E402
from parlant.core.journeys import JourneyId, JourneyNodeId, JourneyStore  # noqa: E402
from parlant.core.loggers import Logger  # noqa: E402
from parlant.core.meter import Meter  # noqa: E402
from parlant.core.services.indexing.behavioral_change_evaluation import JourneyEvaluator  # noqa: E402
from parlant.core.sessions import EventKind, EventSource, SessionStore  # noqa: E402
from parlant.core.tags import Tag  # noqa: E402
from parlant.core.tracer import Tracer  # noqa: E402
from parlant.core.version import VERSION as PARLANT_VERSION  # noqa: E402
from parlant.core.app_modules.sessions import Moderation  # noqa: E402

EXPECTED_PARLANT_VERSION = "3.3.2"
EXPECTED_PARLANT_COMMIT = "61bba3b2b3fffd677d345e393e8c942dbd400297"
LISTEN_HOST = "127.0.0.1"
LOOPBACK_TOKEN_ENV = "YANCE_PARLANT_LOOPBACK_TOKEN"
LOOPBACK_TOKEN_HEADER = "x-yance-parlant-token"
LOOPBACK_CHALLENGE_HEADER = "x-yance-parlant-challenge"
LOOPBACK_HEALTH_PATH = "/yance/healthz"
LOOPBACK_PROOF_DOMAIN = "yance-parlant-health-v1:"
GOAL_CONDITION = "The active relationship conversation should be guided by its configured Yance relationship goal."
COMPLETION_CONDITION = "The configured relationship goal has been achieved, abandoned, or is no longer appropriate to pursue."


def clean(value: Any) -> str:
    return str(value or "").strip()


def required_loopback_token() -> str:
    token = clean(os.environ.get(LOOPBACK_TOKEN_ENV))
    allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
    if not 43 <= len(token) <= 128 or any(character not in allowed for character in token):
        raise RuntimeError("YANCE_PARLANT_LOOPBACK_TOKEN_INVALID")
    return token


def health_instance_proof(token: str, challenge: str) -> str:
    return hmac.new(
        token.encode("utf-8"),
        f"{LOOPBACK_PROOF_DOMAIN}{challenge}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def relationship_key(contact_id: str) -> str:
    value = clean(contact_id)
    if not value or len(value) > 512:
        raise HTTPException(status_code=422, detail={"reasonCode": "YANCE_PARLANT_CONTACT_ID_INVALID", "message": "contactId is invalid"})
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def assert_scope(route_key: str, contact_id: str) -> str:
    expected = relationship_key(contact_id)
    if route_key != expected:
        raise HTTPException(status_code=403, detail={"reasonCode": "YANCE_PARLANT_RELATIONSHIP_SCOPE_MISMATCH", "message": "relationship scope mismatch"})
    return expected


def identifiers(key: str) -> dict[str, str]:
    short = key[:40]
    return {
        "agent": f"yance-agent-{short}",
        "customer": f"yance-customer-{short}",
        "journey": f"yance-goal-{short}",
        "steering_node": f"yance-steer-{short}",
    }


@dataclass
class RuntimeContext:
    container: Container | None = None

    @property
    def app(self) -> Application:
        if self.container is None:
            raise RuntimeError("Parlant container is not initialized")
        return self.container[Application]

    @property
    def journey_store(self) -> JourneyStore:
        if self.container is None:
            raise RuntimeError("Parlant container is not initialized")
        return self.container[JourneyStore]

    @property
    def session_store(self) -> SessionStore:
        if self.container is None:
            raise RuntimeError("Parlant container is not initialized")
        return self.container[SessionStore]


RUNTIME = RuntimeContext()


async def openrouter_service(container: Container):
    error = OpenRouterService.verify_environment()
    if error:
        raise RuntimeError(f"OpenRouter configuration is unavailable: {error}")
    return OpenRouterService(container[Logger], container[Tracer], container[Meter])


async def capture_initialized_container(container: Container) -> Container:
    # start_parlant will initialize this same cloned container with the full
    # persistent Agent/Guideline/Relationship/Session/Journey store stack.
    RUNTIME.container = container
    return container


async def ensure_relationship(key: str):
    ids = identifiers(key)
    app = RUNTIME.app

    try:
        agent = await app.agents.read(AgentId(ids["agent"]))
    except ItemNotFoundError:
        agent = await app.agents.create(
            name=f"Yance relationship {key[:10]}",
            description="Parlant-owned relationship conversation journey agent. Yance retains final send authority.",
            max_engine_iterations=None,
            composition_mode=None,
            message_output_mode=None,
            tags=None,
            id=AgentId(ids["agent"]),
        )

    try:
        customer = await app.customers.read(CustomerId(ids["customer"]))
    except ItemNotFoundError:
        customer = await app.customers.create(
            name=f"Relationship contact {key[:10]}",
            extra={"yance_relationship_key": key},
            tags=None,
            id=CustomerId(ids["customer"]),
        )

    sessions = await app.sessions.find(
        agent_id=agent.id,
        customer_id=customer.id,
        limit=10,
        cursor=None,
        sort_direction=None,
        labels=None,
    )
    session = sessions.items[0] if sessions.items else await app.sessions.create(
        customer_id=customer.id,
        agent_id=agent.id,
        title="Yance relationship journey",
        allow_greeting=False,
        metadata={"yance_relationship_key": key},
        labels={"yance-relationship-goal"},
    )
    return ids, agent, customer, session


async def find_goal(key: str):
    ids = identifiers(key)
    try:
        graph = await RUNTIME.app.journeys.read(JourneyId(ids["journey"]))
        return graph
    except ItemNotFoundError:
        return None


def steering_action(goal_text: str) -> str:
    return (
        "Guide the conversation naturally toward this relationship goal while respecting the contact's current intent and tone: "
        f"{goal_text}. Do not force the topic, fabricate facts, or claim the goal is complete unless the conversation supports it."
    )


async def evaluate_goal_graph(journey_id: JourneyId) -> None:
    if RUNTIME.container is None:
        raise RuntimeError("Parlant container is not initialized")
    evaluations = await RUNTIME.container[JourneyEvaluator].evaluate(
        payloads=[JourneyPayload(journey_id=journey_id, operation=PayloadOperation.ADD)]
    )
    if not evaluations:
        raise RuntimeError("Parlant Journey evaluator returned no result")
    for node_id, properties in (evaluations[0].node_properties_proposition or {}).items():
        if node_id == JourneyStore.END_NODE_ID:
            continue
        for name, value in properties.items():
            await RUNTIME.journey_store.set_node_metadata(node_id=node_id, key=name, value=value)


async def ensure_goal_graph(key: str, goal_text: str):
    ids, agent, _customer, session = await ensure_relationship(key)
    graph = await find_goal(key)
    if graph is None:
        journey, _conditions = await RUNTIME.app.journeys.create(
            title="Yance relationship goal",
            description=goal_text,
            conditions=[GOAL_CONDITION],
            tags=[Tag.for_agent_id(agent.id).id],
            id=JourneyId(ids["journey"]),
            composition_mode=None,
            labels={"yance-relationship-goal"},
            priority=10,
        )
        steering = await RUNTIME.journey_store.create_node(
            journey_id=journey.id,
            action=steering_action(goal_text),
            tools=[],
            description="Use the relationship goal as a conversational direction, not a forced script.",
            composition_mode=None,
            id=JourneyNodeId(ids["steering_node"]),
            labels={"yance-goal-steering"},
        )
        await RUNTIME.journey_store.create_edge(
            journey_id=journey.id,
            source=journey.root_id,
            target=steering.id,
            condition=None,
        )
        await RUNTIME.journey_store.create_edge(
            journey_id=journey.id,
            source=steering.id,
            target=JourneyStore.END_NODE_ID,
            condition=COMPLETION_CONDITION,
        )
        await evaluate_goal_graph(journey.id)
    else:
        await RUNTIME.app.journeys.update(
            journey_id=JourneyId(ids["journey"]),
            title="Yance relationship goal",
            description=goal_text,
            conditions=None,
            tags=None,
            composition_mode=None,
            labels=None,
            priority=10,
        )
        try:
            await RUNTIME.journey_store.update_node(
                JourneyNodeId(ids["steering_node"]),
                {"action": steering_action(goal_text), "description": "Use the relationship goal as a conversational direction, not a forced script."},
            )
        except ItemNotFoundError:
            raise HTTPException(status_code=409, detail={"reasonCode": "YANCE_PARLANT_GOAL_GRAPH_INVALID", "message": "Parlant goal graph is incomplete"})
        await evaluate_goal_graph(JourneyId(ids["journey"]))
    return await goal_projection(key, session=session)


async def goal_projection(key: str, session=None) -> dict[str, Any]:
    graph = await find_goal(key)
    if graph is None:
        return {"ok": True, "available": True, "exists": False, "goalText": "", "paused": False, "progress": {"path": [], "completed": False}}
    _ids, _agent, _customer, resolved_session = await ensure_relationship(key)
    session = session or resolved_session
    persisted_session = await RUNTIME.session_store.read_session(session.id)
    journey_id = graph.journey.id
    path: list[str] = []
    for state in reversed(persisted_session.agent_states):
        raw = state.journey_paths.get(journey_id)
        if raw is not None:
            path = [clean(node) for node in raw if clean(node)]
            break
    completed = bool(path and path[-1] == str(JourneyStore.END_NODE_ID))
    return {
        "ok": True,
        "available": True,
        "exists": True,
        "goalText": graph.journey.description,
        "paused": persisted_session.mode == "manual",
        "progress": {"path": path, "completed": completed},
    }


async def install_yance_routes(api: FastAPI) -> FastAPI:
    loopback_token = required_loopback_token()

    # Yance does not consume Parlant's unauthenticated WebSocket log stream.
    # Remove every upstream WebSocket route rather than ship a second unguarded
    # local control surface beside the authenticated HTTP bridge.
    api.router.routes[:] = [route for route in api.router.routes if not isinstance(route, APIWebSocketRoute)]

    @api.middleware("http")
    async def require_yance_loopback_auth(request: Request, call_next):
        if request.url.path == LOOPBACK_HEALTH_PATH:
            return await call_next(request)
        supplied = clean(request.headers.get(LOOPBACK_TOKEN_HEADER))
        if not hmac.compare_digest(supplied, loopback_token):
            return JSONResponse(
                status_code=403,
                content={
                    "ok": False,
                    "reasonCode": "YANCE_PARLANT_LOOPBACK_AUTH_REQUIRED",
                    "message": "authenticated Yance loopback transport is required",
                },
            )
        return await call_next(request)

    @api.get(LOOPBACK_HEALTH_PATH)
    async def yance_healthz(request: Request):
        challenge = clean(request.headers.get(LOOPBACK_CHALLENGE_HEADER))
        allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        if not 16 <= len(challenge) <= 256 or any(character not in allowed for character in challenge):
            raise HTTPException(
                status_code=422,
                detail={"reasonCode": "YANCE_PARLANT_HEALTH_CHALLENGE_INVALID", "message": "health challenge is invalid"},
            )
        return {
            "ok": True,
            "instanceProof": health_instance_proof(loopback_token, challenge),
            "parlantVersion": PARLANT_VERSION,
        }

    @api.get("/yance/relationship-goals/{route_key}")
    async def get_relationship_goal(route_key: str, contactId: str = Query(...)):
        key = assert_scope(route_key, contactId)
        return await goal_projection(key)

    @api.put("/yance/relationship-goals/{route_key}")
    async def put_relationship_goal(route_key: str, payload: dict[str, Any] = Body(...)):
        contact_id = clean(payload.get("contactId"))
        key = assert_scope(route_key, contact_id)
        goal_text = clean(payload.get("goalText"))
        if not goal_text or len(goal_text) > 4000:
            raise HTTPException(status_code=422, detail={"reasonCode": "YANCE_PARLANT_GOAL_INVALID", "message": "goalText is invalid"})
        return await ensure_goal_graph(key, goal_text)

    @api.delete("/yance/relationship-goals/{route_key}")
    async def delete_relationship_goal(route_key: str, contactId: str = Query(...)):
        key = assert_scope(route_key, contactId)
        graph = await find_goal(key)
        if graph is not None:
            await RUNTIME.app.journeys.delete(graph.journey.id)
        return {"ok": True, "deleted": graph is not None}

    @api.patch("/yance/relationship-goals/{route_key}/mode")
    async def set_relationship_goal_mode(route_key: str, payload: dict[str, Any] = Body(...)):
        contact_id = clean(payload.get("contactId"))
        key = assert_scope(route_key, contact_id)
        graph = await find_goal(key)
        if graph is None:
            raise HTTPException(status_code=404, detail={"reasonCode": "YANCE_PARLANT_GOAL_NOT_FOUND", "message": "relationship goal does not exist"})
        _ids, _agent, _customer, session = await ensure_relationship(key)
        await RUNTIME.app.sessions.update(session.id, {"mode": "manual" if payload.get("paused") is True else "auto"}, labels=None)
        return await goal_projection(key)

    @api.post("/yance/relationship-goals/{route_key}/events")
    async def ingest_relationship_event(route_key: str, payload: dict[str, Any] = Body(...)):
        contact_id = clean(payload.get("contactId"))
        key = assert_scope(route_key, contact_id)
        graph = await find_goal(key)
        if graph is None:
            raise HTTPException(status_code=404, detail={"reasonCode": "YANCE_PARLANT_GOAL_NOT_FOUND", "message": "relationship goal does not exist"})
        text = clean(payload.get("text"))
        if not text or len(text) > 20000:
            raise HTTPException(status_code=422, detail={"reasonCode": "YANCE_PARLANT_MESSAGE_INVALID", "message": "message text is invalid"})
        _ids, _agent, _customer, session = await ensure_relationship(key)
        current = await RUNTIME.session_store.read_session(session.id)
        if RUNTIME.container is None:
            raise RuntimeError("Parlant container is not initialized")
        with RUNTIME.container[Tracer].span("yance.relationship.ingest", {"yance.relationship_key": key}):
            event = await RUNTIME.app.sessions.create_customer_message(
                session_id=session.id,
                moderation=Moderation.NONE,
                message=text,
                source=EventSource.CUSTOMER,
                trigger_processing=current.mode != "manual",
                metadata={
                    "yance_external_message_id": clean(payload.get("externalMessageId"))[:512],
                    "yance_relationship_key": key,
                },
            )
        return {"ok": True, "eventId": str(event.id), "traceId": str(event.trace_id), "offset": int(event.offset), "nextOffset": int(event.offset) + 1, "paused": current.mode == "manual"}

    @api.get("/yance/relationship-goals/{route_key}/candidate")
    async def get_relationship_candidate(
        route_key: str,
        contactId: str = Query(...),
        after_offset: int = Query(0, ge=0),
        processing_trace_id: str = Query(..., min_length=1, max_length=512),
    ):
        key = assert_scope(route_key, contactId)
        graph = await find_goal(key)
        if graph is None:
            raise HTTPException(status_code=404, detail={"reasonCode": "YANCE_PARLANT_GOAL_NOT_FOUND", "message": "relationship goal does not exist"})
        _ids, _agent, _customer, session = await ensure_relationship(key)
        current = await RUNTIME.session_store.read_session(session.id)
        if current.mode == "manual":
            raise HTTPException(status_code=409, detail={"reasonCode": "YANCE_PARLANT_GOAL_PAUSED", "message": "relationship goal is paused in Parlant manual mode"})
        deadline = asyncio.get_running_loop().time() + 90.0
        while asyncio.get_running_loop().time() < deadline:
            events = await RUNTIME.app.sessions.find_events(
                session_id=session.id,
                min_offset=after_offset,
                source=EventSource.AI_AGENT,
                kinds=[EventKind.MESSAGE],
                trace_id=processing_trace_id,
            )
            candidates = sorted((event for event in events if int(event.offset) >= after_offset), key=lambda event: int(event.offset))
            for event in candidates:
                data = event.data if isinstance(event.data, dict) else {}
                text = clean(data.get("message"))
                if text:
                    return {
                        "ok": True,
                        "text": text,
                        "eventId": str(event.id),
                        "traceId": str(event.trace_id),
                        "offset": int(event.offset),
                        "progress": (await goal_projection(key))["progress"],
                    }
            await asyncio.sleep(0.25)
        raise HTTPException(status_code=504, detail={"reasonCode": "YANCE_PARLANT_CANDIDATE_TIMEOUT", "message": "Parlant did not produce a candidate before timeout"})

    return api


def self_test() -> int:
    result = {
        "ok": PARLANT_VERSION == EXPECTED_PARLANT_VERSION,
        "parlantVersion": PARLANT_VERSION,
        "expectedVersion": EXPECTED_PARLANT_VERSION,
        "expectedCommit": EXPECTED_PARLANT_COMMIT,
        "listenHost": LISTEN_HOST,
        "dataCollection": os.environ.get("PARLANT_DATA_COLLECTION"),
        "persistentServer": True,
        "applicationAuthority": Application.__module__,
        "journeyStoreAuthority": JourneyStore.__module__,
        "sessionStoreAuthority": SessionStore.__module__,
    }
    print(json.dumps(result, sort_keys=True))
    return 0 if result["ok"] and result["dataCollection"] == "false" and result["listenHost"] == "127.0.0.1" else 1


async def serve(host: str, port: int) -> None:
    if host != LISTEN_HOST:
        raise RuntimeError("Yance Parlant bridge refuses non-loopback listeners")
    if clean(os.environ.get("PARLANT_ENV")) != "production":
        raise RuntimeError("YANCE_PARLANT_PRODUCTION_AUTH_REQUIRED")
    required_loopback_token()
    if not clean(os.environ.get("OPENROUTER_API_KEY")):
        raise RuntimeError("OPENROUTER_API_KEY is required")
    params = StartupParameters(
        host=LISTEN_HOST,
        port=port,
        nlp_service=openrouter_service,
        log_level="warning",
        modules=[],
        migrate=False,
        configure=capture_initialized_container,
        initialize=None,
        configure_api=install_yance_routes,
    )
    async with start_parlant(params):
        pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Yance thin adapter for Parlant Relationship Goal/Journey P0")
    parser.add_argument("--host", default=LISTEN_HOST)
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        return self_test()
    asyncio.run(serve(args.host, args.port))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())