import { MediaWorkspace } from "./MediaWorkspace";
import React, { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "yance.workspace.active-capability";
const CAPABILITIES = ["AI", "Goal", "Contact", "Presence", "Media"] as const;
type Capability = (typeof CAPABILITIES)[number];

type LettaState = {
  ready?: boolean;
  reasonCode?: string;
};

type LettaAgent = { id?: string; name?: string };
type LettaConversation = { id?: string; agentId?: string };

type RelationshipGoalProjection = {
  available: boolean;
  exists: boolean | null;
  goalText: string;
  paused: boolean;
  progress: { path: string[]; completed: boolean };
  reasonCode: string;
};

type RelationshipOption = { id: string; name: string };

type DesktopEvent = {
  type?: string;
  payload?: {
    message?: { contactId?: string };
    contactId?: string;
  };
};

type LettaDesktopApi = {
  getLettaState: () => Promise<LettaState>;
  listLettaAgents: () => Promise<LettaAgent[]>;
  listLettaConversations: (input: { agentId: string; limit?: number }) => Promise<LettaConversation[]>;
};

type RelationshipGoalDesktopApi = {
  storeSnapshot: (input: { domains: string[] }) => Promise<Record<string, unknown>>;
  getParlantRelationshipGoal: (input: { contactId: string }) => Promise<RelationshipGoalProjection>;
  upsertParlantRelationshipGoal: (input: { contactId: string; goalText: string }) => Promise<RelationshipGoalProjection>;
  deleteParlantRelationshipGoal: (input: { contactId: string }) => Promise<{ deleted: boolean }>;
  setParlantRelationshipGoalPaused: (input: { contactId: string; paused: boolean }) => Promise<RelationshipGoalProjection>;
  onDesktopEvent: (callback: (event: DesktopEvent) => void) => (() => void);
};

type YanceDesktopApi = LettaDesktopApi & RelationshipGoalDesktopApi;

function initialCapability(): Capability {
  const stored = localStorage.getItem(STORAGE_KEY);
  return CAPABILITIES.includes(stored as Capability) ? (stored as Capability) : "AI";
}

function desktopApi(): YanceDesktopApi | null {
  const desktop = (window as unknown as { yanceDesktop?: Partial<YanceDesktopApi> }).yanceDesktop;
  if (!desktop) return null;
  return desktop as YanceDesktopApi;
}

function lettaDesktopApi(): LettaDesktopApi | null {
  const desktop = desktopApi();
  if (!desktop || typeof desktop.getLettaState !== "function" || typeof desktop.listLettaAgents !== "function" || typeof desktop.listLettaConversations !== "function") return null;
  return desktop;
}

function relationshipGoalDesktopApi(): RelationshipGoalDesktopApi | null {
  const desktop = desktopApi();
  if (!desktop
    || typeof desktop.storeSnapshot !== "function"
    || typeof desktop.getParlantRelationshipGoal !== "function"
    || typeof desktop.upsertParlantRelationshipGoal !== "function"
    || typeof desktop.deleteParlantRelationshipGoal !== "function"
    || typeof desktop.setParlantRelationshipGoalPaused !== "function") return null;
  return desktop;
}

function relationshipOptions(payload: unknown): RelationshipOption[] {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const snapshot = (root.snapshot && typeof root.snapshot === "object" ? root.snapshot : root) as Record<string, unknown>;
  const customers = (snapshot.customers && typeof snapshot.customers === "object" ? snapshot.customers : {}) as Record<string, unknown>;
  const byId = (customers.byId && typeof customers.byId === "object" ? customers.byId : {}) as Record<string, unknown>;
  return Object.entries(byId)
    .map(([key, value]) => {
      const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      const id = String(row.id || row.contactId || key || "").trim();
      const name = String(row.displayName || row.name || row.title || id || "Relationship").trim();
      return { id, name };
    })
    .filter((row) => row.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function emptyGoal(reasonCode = ""): RelationshipGoalProjection {
  return { available: !reasonCode, exists: false, goalText: "", paused: false, progress: { path: [], completed: false }, reasonCode };
}

export function YanceWorkspace(): React.JSX.Element {
  const [activeCapability, setActiveCapability] = useState<Capability>(initialCapability);
  const [lettaState, setLettaState] = useState<LettaState>({ ready: false });
  const [lettaAgents, setLettaAgents] = useState<LettaAgent[]>([]);
  const [lettaConversations, setLettaConversations] = useState<LettaConversation[]>([]);
  const [lettaStatus, setLettaStatus] = useState("Loading");

  const [relationships, setRelationships] = useState<RelationshipOption[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [goal, setGoal] = useState<RelationshipGoalProjection>(emptyGoal());
  const [goalDraft, setGoalDraft] = useState("");
  const [goalStatus, setGoalStatus] = useState("Select a relationship");
  const [goalBusy, setGoalBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeCapability);
  }, [activeCapability]);

  useEffect(() => {
    let cancelled = false;
    let refreshInFlight = false;
    const api = lettaDesktopApi();
    if (!api) {
      setLettaStatus("Desktop bridge unavailable");
      return () => { cancelled = true; };
    }

    const load = async (): Promise<void> => {
      if (refreshInFlight || cancelled) return;
      refreshInFlight = true;
      try {
        const state = await api.getLettaState();
        if (cancelled) return;
        setLettaState(state || { ready: false });
        if (!state?.ready) {
          setLettaAgents([]);
          setLettaConversations([]);
          setLettaStatus(state?.reasonCode || "Not ready");
          return;
        }
        const agents = await api.listLettaAgents();
        if (cancelled) return;
        const normalizedAgents = Array.isArray(agents) ? agents : [];
        setLettaAgents(normalizedAgents);
        const firstAgentId = String(normalizedAgents[0]?.id || "").trim();
        if (firstAgentId) {
          const conversations = await api.listLettaConversations({ agentId: firstAgentId, limit: 20 });
          if (!cancelled) setLettaConversations(Array.isArray(conversations) ? conversations : []);
        } else {
          setLettaConversations([]);
        }
        if (!cancelled) setLettaStatus("Ready");
      } catch (_) {
        if (!cancelled) {
          setLettaState({ ready: false, reasonCode: "LETTA_PROJECTION_UNAVAILABLE" });
          setLettaAgents([]);
          setLettaConversations([]);
          setLettaStatus("Letta state unavailable");
        }
      } finally {
        refreshInFlight = false;
      }
    };

    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const api = relationshipGoalDesktopApi();
    if (!api) {
      setGoal(emptyGoal("DESKTOP_PARLANT_BRIDGE_UNAVAILABLE"));
      setGoalStatus("Goal runtime bridge unavailable");
      return () => { cancelled = true; };
    }
    const loadRelationships = async (): Promise<void> => {
      try {
        const payload = await api.storeSnapshot({ domains: ["customers"] });
        if (cancelled) return;
        const rows = relationshipOptions(payload);
        setRelationships(rows);
        setSelectedContactId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
      } catch (_) {
        if (!cancelled) setGoalStatus("Relationship list unavailable");
      }
    };
    void loadRelationships();
    return () => { cancelled = true; };
  }, []);

  const selectedContactRef = React.useRef(selectedContactId);
  useEffect(() => {
    selectedContactRef.current = selectedContactId;
  }, [selectedContactId]);

  useEffect(() => {
    const api = relationshipGoalDesktopApi();
    if (!api) return () => {};
    const unsubscribe = typeof api.onDesktopEvent === "function" ? api.onDesktopEvent((event) => {
      const contactId = String(event?.payload?.message?.contactId || event?.payload?.contactId || "").trim();
      if (event?.type === "parlant:relationship-goal-degraded" && contactId === selectedContactRef.current) {
        setGoalStatus(`Degraded: ${String((event.payload as { reasonCode?: string })?.reasonCode || "PARLANT_UNAVAILABLE")}`);
      }
    }) : () => {};
    return () => { unsubscribe?.(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const api = relationshipGoalDesktopApi();
    if (!api || !selectedContactId) {
      setGoal(emptyGoal());
      setGoalDraft("");
      setGoalStatus(selectedContactId ? "Goal runtime bridge unavailable" : "Select a relationship");
      return () => { cancelled = true; };
    }
    const loadGoal = async (): Promise<void> => {
      setGoalBusy(true);
      try {
        const next = await api.getParlantRelationshipGoal({ contactId: selectedContactId });
        if (cancelled) return;
        setGoal(next);
        setGoalDraft(next.exists ? next.goalText : "");
        setGoalStatus(next.available ? (next.exists ? (next.paused ? "Paused" : "Active") : "No goal configured") : `Degraded: ${next.reasonCode || "PARLANT_UNAVAILABLE"}`);
      } catch (error) {
        if (!cancelled) {
          const code = String((error as { reasonCode?: string; code?: string })?.reasonCode || (error as { code?: string })?.code || "PARLANT_UNAVAILABLE");
          setGoal(emptyGoal(code));
          setGoalStatus(`Degraded: ${code}`);
        }
      } finally {
        if (!cancelled) setGoalBusy(false);
      }
    };
    void loadGoal();
    return () => { cancelled = true; };
  }, [selectedContactId]);

  const selectedRelationship = useMemo(
    () => relationships.find((row) => row.id === selectedContactId) || null,
    [relationships, selectedContactId]
  );

  const saveGoal = async (): Promise<void> => {
    const api = relationshipGoalDesktopApi();
    const text = goalDraft.trim();
    if (!api || !selectedContactId || !text || goalBusy) return;
    setGoalBusy(true);
    try {
      const next = await api.upsertParlantRelationshipGoal({ contactId: selectedContactId, goalText: text });
      setGoal(next);
      setGoalDraft(next.goalText);
      setGoalStatus(next.paused ? "Paused" : "Active");
    } catch (error) {
      setGoalStatus(`Degraded: ${String((error as { reasonCode?: string; code?: string })?.reasonCode || (error as { code?: string })?.code || "PARLANT_UNAVAILABLE")}`);
    } finally {
      setGoalBusy(false);
    }
  };

  const toggleGoalPaused = async (): Promise<void> => {
    const api = relationshipGoalDesktopApi();
    if (!api || !selectedContactId || goalBusy || goal.exists !== true) return;
    setGoalBusy(true);
    try {
      const next = await api.setParlantRelationshipGoalPaused({ contactId: selectedContactId, paused: !goal.paused });
      setGoal(next);
      setGoalStatus(next.paused ? "Paused" : "Active");
    } catch (error) {
      setGoalStatus(`Degraded: ${String((error as { reasonCode?: string; code?: string })?.reasonCode || (error as { code?: string })?.code || "PARLANT_UNAVAILABLE")}`);
    } finally {
      setGoalBusy(false);
    }
  };

  const deleteGoal = async (): Promise<void> => {
    const api = relationshipGoalDesktopApi();
    if (!api || !selectedContactId || goalBusy || goal.exists !== true) return;
    setGoalBusy(true);
    try {
      await api.deleteParlantRelationshipGoal({ contactId: selectedContactId });
      setGoal(emptyGoal());
      setGoalDraft("");
      setGoalStatus("No goal configured");
    } catch (error) {
      setGoalStatus(`Degraded: ${String((error as { reasonCode?: string; code?: string })?.reasonCode || (error as { code?: string })?.code || "PARLANT_UNAVAILABLE")}`);
    } finally {
      setGoalBusy(false);
    }
  };

  const progressText = goal.progress.completed
    ? "Completed"
    : goal.progress.path.length
      ? `Journey step ${goal.progress.path.length} · ${goal.progress.path.at(-1)}`
      : goal.exists === true ? "Journey ready" : "—";

  return (
    <section data-yance-workspace aria-label="Yance Workspace">
      <header><strong>Yance Workspace</strong></header>
      <nav aria-label="Yance workspace capabilities">
        {CAPABILITIES.map((capability) => (
          <button
            key={capability}
            type="button"
            aria-pressed={activeCapability === capability}
            onClick={() => setActiveCapability(capability)}
          >
            {capability}
          </button>
        ))}
      </nav>
      <dl>
        <dt>AI</dt><dd>Conversation copilot</dd>
        <dt>Goal</dt><dd>Parlant-owned relationship journey</dd>
        <dt>Contact</dt><dd>Unified relationship context</dd>
        <dt>Presence</dt><dd>Channel and bridge presence</dd>
        <dt>Media</dt><dd>Immich library and ComfyUI image workflows</dd>
      </dl>
      {activeCapability === "AI" ? (
        <aside aria-label="Letta persistent agent status">
          <strong>Letta</strong>
          <dl>
            <dt>Runtime</dt><dd>{lettaState.ready ? "Ready" : lettaStatus}</dd>
            <dt>Agents</dt><dd>{lettaAgents.length}</dd>
            <dt>Recent conversations (first agent)</dt><dd>{lettaConversations.length >= 20 ? "20+" : lettaConversations.length}</dd>
          </dl>
        </aside>
      ) : null}
      {activeCapability === "Goal" ? (
        <aside aria-label="Relationship Goal">
          <strong>Relationship Goal</strong>
          <label>
            Relationship
            <select value={selectedContactId} onChange={(event) => setSelectedContactId(event.target.value)} disabled={goalBusy}>
              {relationships.length ? relationships.map((row) => <option key={row.id} value={row.id}>{row.name}</option>) : <option value="">No active relationships</option>}
            </select>
          </label>
          <div aria-live="polite">{selectedRelationship?.name || "No relationship"} · {goalStatus}</div>
          <label>
            Conversation objective
            <textarea
              value={goalDraft}
              maxLength={4000}
              rows={5}
              disabled={!selectedContactId || goalBusy || !goal.available && goal.exists === null}
              onChange={(event) => setGoalDraft(event.target.value)}
              placeholder="Example: naturally guide the conversation toward scheduling a call this week."
            />
          </label>
          <div>
            <button type="button" onClick={() => { void saveGoal(); }} disabled={!selectedContactId || !goalDraft.trim() || goalBusy}>Save goal</button>
            <button type="button" onClick={() => { void toggleGoalPaused(); }} disabled={goal.exists !== true || goalBusy}>{goal.paused ? "Resume" : "Pause"}</button>
            <button type="button" onClick={() => { void deleteGoal(); }} disabled={goal.exists !== true || goalBusy}>Delete</button>
          </div>
          <dl>
            <dt>Authority</dt><dd>Parlant Journey</dd>
            <dt>Progress</dt><dd>{progressText}</dd>
            <dt>Send authority</dt><dd>Yance approval and channel pipeline</dd>
          </dl>
        </aside>
      ) : null}
      {activeCapability === "Media" ? <MediaWorkspace /> : null}
    </section>
  );
}
