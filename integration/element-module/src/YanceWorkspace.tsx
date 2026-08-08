import React, { useEffect, useState } from "react";

const STORAGE_KEY = "yance.workspace.active-capability";
const CAPABILITIES = ["AI", "Goal", "Contact", "Presence"] as const;
type Capability = (typeof CAPABILITIES)[number];

type LettaState = {
  ready?: boolean;
  reasonCode?: string;
};

type LettaAgent = { id?: string; name?: string };
type LettaConversation = { id?: string; agentId?: string };

type LettaDesktopApi = {
  getLettaState: () => Promise<LettaState>;
  listLettaAgents: () => Promise<LettaAgent[]>;
  listLettaConversations: (input: { agentId: string; limit?: number }) => Promise<LettaConversation[]>;
};

function initialCapability(): Capability {
  const stored = localStorage.getItem(STORAGE_KEY);
  return CAPABILITIES.includes(stored as Capability) ? (stored as Capability) : "AI";
}

function lettaDesktopApi(): LettaDesktopApi | null {
  const desktop = (window as unknown as { yanceDesktop?: Partial<LettaDesktopApi> }).yanceDesktop;
  if (!desktop || typeof desktop.getLettaState !== "function" || typeof desktop.listLettaAgents !== "function" || typeof desktop.listLettaConversations !== "function") return null;
  return desktop as LettaDesktopApi;
}

export function YanceWorkspace(): React.JSX.Element {
  const [activeCapability, setActiveCapability] = useState<Capability>(initialCapability);
  const [lettaState, setLettaState] = useState<LettaState>({ ready: false });
  const [lettaAgents, setLettaAgents] = useState<LettaAgent[]>([]);
  const [lettaConversations, setLettaConversations] = useState<LettaConversation[]>([]);
  const [lettaStatus, setLettaStatus] = useState("Loading");

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
        <dt>Goal</dt><dd>Current conversation objective</dd>
        <dt>Contact</dt><dd>Unified relationship context</dd>
        <dt>Presence</dt><dd>Channel and bridge presence</dd>
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
    </section>
  );
}
