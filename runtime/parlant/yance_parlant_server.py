from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from typing import Literal

os.environ["PARLANT_DATA_COLLECTION"] = "false"
if os.environ.get("YANCE_PARLANT_DATA_ROOT"):
    os.environ["PARLANT_HOME"] = os.environ["YANCE_PARLANT_DATA_ROOT"]

from fastapi import FastAPI, HTTPException
from lagom import Container
from pydantic import BaseModel, ConfigDict, Field

from parlant.adapters.nlp.openrouter_service import OpenRouterService
from parlant.bin.server import StartupParameters, start_parlant
from parlant.core.agents import AgentId
from parlant.core.application import Application
from parlant.core.async_utils import Timeout
from parlant.core.common import ItemNotFoundError
from parlant.core.customers import CustomerId
from parlant.core.journeys import JourneyId, JourneyNodeId, JourneyStore
from parlant.core.loggers import Logger
from parlant.core.meter import Meter
from parlant.core.nlp.service import NLPService, NLPServiceConfigurationError
from parlant.core.sessions import EventKind, EventSource, Session, SessionStore
from parlant.core.tags import Tag
from parlant.core.tracer import Tracer
from parlant.core.version import VERSION
from parlant.core.app_modules.sessions import Moderation

PARLANT_VERSION = "3.3.2"
PARLANT_COMMIT = "61bba3b2b3fffd677d345e393e8c942dbd400297"
LISTEN_HOST = "127.0.0.1"
DEFAULT_PORT = 18765
GOAL_CONDITION = "Always activate this relationship goal journey"
GOAL_ACTION = (
    "Naturally guide the conversation toward the relationship goal described in this Journey. "
    "Stay responsive to the customer's current message, avoid abrupt topic changes, and never "
    "claim the goal is complete until the conversation itself supports that conclusion."
)
GOAL_DONE_CONDITION = (
    "The relationship goal has been achieved, or the user explicitly abandoned or replaced it"
)


class GoalUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contactId: str = Field(min_length=1, max_length=512)
    goal: str = Field(min_length=1, max_length=4000)


class GoalMode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contactId: str = Field(min_length=1, max_length=512)
    mode: Literal["manual", "auto"]


class CustomerMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contactId: str = Field(min_length=1, max_length=512)
    source: Literal["customer"]
    text: str = Field(min_length=1, max_length=20000)


def relationship_key(contact_id: str) -> str:
    normalized = contact_id.strip()
    if not normalized:
        raise HTTPException(status_code=422, detail="contactId is required")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def require_relationship_key(route_key: str, contact_id: str) -> str:
    expected = relationship_key(contact_id)
    if route_key != expected:
        raise HTTPException(status_code=409, detail="relationship isolation key mismatch")
    return expected


def agent_id_for(key: str) -> AgentId:
    return AgentId(f"yance-agent-{key[:40]}")


def customer_id_for(key: str) -> CustomerId:
    return CustomerId(f"yance-customer-{key[:40]}")


def journey_id_for(key: str) -> JourneyId:
    return JourneyId(f"yance-goal-{key[:40]}")


def steering_node_id_for(key: str) -> JourneyNodeId:
    return JourneyNodeId(f"yance-steer-{key[:40]}")


def relationship_label(key: str) -> str:
    return f"yance-relationship-{key}"


async def create_openrouter_service(container: Container) -> NLPService:
    if error := OpenRouterService.verify_environment():
        raise NLPServiceConfigurationError(error)
    return OpenRouterService(container[Logger], container[Tracer], container[Meter])


async def ensure_agent(app: Application, key: str):
    agent_id = agent_id_for(key)
    try:
        return await app.agents.read(agent_id)
    except ItemNotFoundError:
        return await app.agents.create(
            name=f"Yance relationship {key[:12]}",
            description=(
                "Relationship-specific Parlant agent. Journey and Session state are authoritative "
                "inside Parlant; Yance only projects bounded Goal state and retains send authority."
            ),
            max_engine_iterations=None,
            composition_mode=None,
            message_output_mode=None,
            tags=None,
            id=agent_id,
        )


async def ensure_customer(app: Application, key: str, contact_id: str):
    customer_id = customer_id_for(key)
    try:
        return await app.customers.read(customer_id)
    except ItemNotFoundError:
        return await app.customers.create(
            name=f"Yance contact {contact_id[:80]}",
            extra={"yance_relationship_key": key},
            tags=None,
            id=customer_id,
        )


async def find_session(app: Application, key: str, agent_id: AgentId, customer_id: CustomerId) -> Session | None:
    listing = await app.sessions.find(
        agent_id=agent_id,
        customer_id=customer_id,
        labels={relationship_label(key)},
    )
    if not listing.items:
        return None
    return sorted(listing.items, key=lambda item: item.creation_utc)[-1]


async def ensure_session(app: Application, key: str, agent_id: AgentId, customer_id: CustomerId) -> Session:
    if session := await find_session(app, key, agent_id, customer_id):
        return session
    return await app.sessions.create(
        customer_id=customer_id,
        agent_id=agent_id,
        title=f"Yance relationship {key[:12]}",
        allow_greeting=False,
        metadata={"yance_relationship_key": key},
        labels={relationship_label(key)},
    )


async def read_journey_or_none(app: Application, key: str):
    try:
        return await app.journeys.read(journey_id_for(key))
    except ItemNotFoundError:
        return None


async def ensure_goal_journey(
    app: Application,
    journey_store: JourneyStore,
    key: str,
    goal: str,
    agent_id: AgentId,
):
    journey_graph = await read_journey_or_none(app, key)
    if journey_graph:
        await app.journeys.update(
            journey_id=journey_id_for(key),
            title=None,
            description=goal,
            conditions=None,
            tags=None,
            composition_mode=None,
            labels=None,
            priority=None,
        )
        return await app.journeys.read(journey_id_for(key))

    journey, _ = await app.journeys.create(
        title=f"Yance relationship goal {key[:12]}",
        description=goal,
        conditions=[GOAL_CONDITION],
        tags=[Tag.for_agent_id(agent_id).id],
        id=journey_id_for(key),
        composition_mode=None,
        labels={"yance-relationship-goal"},
        priority=100,
    )

    steering_node = await journey_store.create_node(
        journey_id=journey.id,
        action=GOAL_ACTION,
        tools=[],
        description="Adaptive goal steering owned by Parlant Journey traversal",
        id=steering_node_id_for(key),
        labels={"yance-goal-steering"},
    )
    await journey_store.create_edge(
        journey_id=journey.id,
        source=journey.root_id,
        target=steering_node.id,
        condition=None,
    )
    await journey_store.create_edge(
        journey_id=journey.id,
        source=steering_node.id,
        target=JourneyStore.END_NODE_ID,
        condition=GOAL_DONE_CONDITION,
    )
    return await app.journeys.read(journey.id)


def journey_progress(session: Session | None, journey_id: JourneyId) -> tuple[str, str]:
    if session is None:
        return "not-started", "active"
    for agent_state in reversed(session.agent_states):
        path = agent_state.journey_paths.get(journey_id)
        if path:
            visited = [node for node in path if node]
            if visited and visited[-1] == JourneyStore.END_NODE_ID:
                return "completed", "completed"
            return f"visited:{len(visited)}", "paused" if session.mode == "manual" else "active"
    return "not-started", "paused" if session.mode == "manual" else "active"


async def projection(app: Application, key: str, contact_id: str) -> dict[str, object]:
    graph = await read_journey_or_none(app, key)
    if graph is None:
        return {
            "contactId": contact_id,
            "goal": "",
            "paused": False,
            "progress": "not-started",
            "reasonCode": "",
            "status": "inactive",
        }

    agent_id = agent_id_for(key)
    customer_id = customer_id_for(key)
    session = await find_session(app, key, agent_id, customer_id)
    progress, status = journey_progress(session, graph.journey.id)
    return {
        "contactId": contact_id,
        "goal": graph.journey.description,
        "paused": bool(session and session.mode == "manual"),
        "progress": progress,
        "reasonCode": "",
        "status": status,
    }


def configure_yance_api(holder: dict[str, Container]):
    async def configure(api: FastAPI) -> FastAPI:
        container = holder["container"]
        app = container[Application]
        journey_store = container[JourneyStore]

        @api.get("/yance/relationship-goals/{key}")
        async def get_relationship_goal(key: str, contactId: str):
            require_relationship_key(key, contactId)
            return await projection(app, key, contactId)

        @api.put("/yance/relationship-goals/{key}")
        async def upsert_relationship_goal(key: str, body: GoalUpsert):
            require_relationship_key(key, body.contactId)
            agent = await ensure_agent(app, key)
            customer = await ensure_customer(app, key, body.contactId)
            await ensure_session(app, key, agent.id, customer.id)
            await ensure_goal_journey(app, journey_store, key, body.goal.strip(), agent.id)
            return await projection(app, key, body.contactId)

        @api.delete("/yance/relationship-goals/{key}", status_code=204)
        async def delete_relationship_goal(key: str, contactId: str):
            require_relationship_key(key, contactId)
            try:
                await app.journeys.delete(journey_id_for(key))
            except ItemNotFoundError:
                pass
            return None

        @api.patch("/yance/relationship-goals/{key}/mode")
        async def set_relationship_goal_mode(key: str, body: GoalMode):
            require_relationship_key(key, body.contactId)
            if await read_journey_or_none(app, key) is None:
                raise HTTPException(status_code=404, detail="relationship goal not found")
            agent = await ensure_agent(app, key)
            customer = await ensure_customer(app, key, body.contactId)
            session = await ensure_session(app, key, agent.id, customer.id)
            await app.sessions.update(session.id, {"mode": body.mode})
            return await projection(app, key, body.contactId)

        @api.post("/yance/relationship-events/{key}")
        async def ingest_relationship_event(key: str, body: CustomerMessage):
            require_relationship_key(key, body.contactId)
            if await read_journey_or_none(app, key) is None:
                raise HTTPException(status_code=409, detail="relationship goal is not configured")
            agent = await ensure_agent(app, key)
            customer = await ensure_customer(app, key, body.contactId)
            session = await ensure_session(app, key, agent.id, customer.id)
            event = await app.sessions.create_customer_message(
                session_id=session.id,
                moderation=Moderation.NONE,
                message=body.text.strip(),
                source=EventSource.CUSTOMER,
                trigger_processing=True,
                metadata={"yance_relationship_key": key},
            )
            return {"eventId": str(event.id), "offset": event.offset, "sessionId": str(session.id)}

        @api.get("/yance/relationship-candidates/{key}")
        async def get_relationship_candidate(key: str, contactId: str, after_offset: int = -1):
            require_relationship_key(key, contactId)
            if await read_journey_or_none(app, key) is None:
                raise HTTPException(status_code=409, detail="relationship goal is not configured")
            agent = await ensure_agent(app, key)
            customer = await ensure_customer(app, key, contactId)
            session = await ensure_session(app, key, agent.id, customer.id)
            minimum = max(0, after_offset + 1)
            events = await app.sessions.find_events(
                session_id=session.id,
                min_offset=minimum,
                source=EventSource.AI_AGENT,
                kinds=[EventKind.MESSAGE],
                trace_id=None,
            )
            if not events:
                await app.sessions.wait_for_more_events(
                    session_id=session.id,
                    min_offset=minimum,
                    kinds=[EventKind.MESSAGE],
                    source=EventSource.AI_AGENT,
                    timeout=Timeout(30),
                )
                events = await app.sessions.find_events(
                    session_id=session.id,
                    min_offset=minimum,
                    source=EventSource.AI_AGENT,
                    kinds=[EventKind.MESSAGE],
                    trace_id=None,
                )
            if not events:
                raise HTTPException(status_code=504, detail="Parlant reply candidate timed out")
            event = sorted(events, key=lambda item: item.offset)[0]
            message = event.data.get("message") if isinstance(event.data, dict) else None
            if not isinstance(message, str) or not message.strip():
                raise HTTPException(status_code=502, detail="Parlant returned an invalid reply candidate")
            return {"text": message, "eventId": str(event.id), "offset": event.offset}

        return api

    return configure


async def run_server(host: str, port: int) -> None:
    if host != LISTEN_HOST:
        raise SystemExit("Parlant Yance bridge must bind to 127.0.0.1")
    data_root = os.environ.get("YANCE_PARLANT_DATA_ROOT", "").strip()
    if not data_root:
        raise SystemExit("YANCE_PARLANT_DATA_ROOT is required")
    if not os.environ.get("OPENROUTER_API_KEY", "").strip():
        raise SystemExit("OPENROUTER_API_KEY is required")

    holder: dict[str, Container] = {}

    async def capture_container(container: Container) -> Container:
        holder["container"] = container
        return container

    params = StartupParameters(
        host=LISTEN_HOST,
        port=port,
        nlp_service=create_openrouter_service,
        log_level="info",
        modules=[],
        migrate=False,
        configure=capture_container,
        initialize=None,
        configure_api=configure_yance_api(holder),
    )

    async with start_parlant(params):
        pass


def self_test() -> None:
    if VERSION != PARLANT_VERSION:
        raise SystemExit(f"Parlant version mismatch: expected {PARLANT_VERSION}, got {VERSION}")
    print(
        json.dumps(
            {
                "ok": True,
                "parlantVersion": VERSION,
                "parlantCommit": PARLANT_COMMIT,
                "listenHost": LISTEN_HOST,
                "dataCollection": os.environ.get("PARLANT_DATA_COLLECTION"),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Yance Parlant relationship goal bridge")
    parser.add_argument("--host", default=LISTEN_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.self_test:
        self_test()
        return
    asyncio.run(run_server(args.host, args.port))


if __name__ == "__main__":
    main()
