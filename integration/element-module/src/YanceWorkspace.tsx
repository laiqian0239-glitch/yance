import React, { useEffect, useState } from "react";

const STORAGE_KEY = "yance.workspace.active-capability";
const CAPABILITIES = ["AI", "Goal", "Contact", "Presence"] as const;
type Capability = (typeof CAPABILITIES)[number];

function initialCapability(): Capability {
  const stored = localStorage.getItem(STORAGE_KEY);
  return CAPABILITIES.includes(stored as Capability) ? (stored as Capability) : "AI";
}

export function YanceWorkspace(): React.JSX.Element {
  const [activeCapability, setActiveCapability] = useState<Capability>(initialCapability);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeCapability);
  }, [activeCapability]);

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
        <dt>Contact</dt><dd>Unified customer context</dd>
        <dt>Presence</dt><dd>Channel and bridge presence</dd>
      </dl>
    </section>
  );
}
