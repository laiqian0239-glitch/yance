import React, { useEffect, useState } from "react";

const STORAGE_KEY = "yance.workspace.visible";

export function YanceWorkspace(): React.JSX.Element {
  const [visible, setVisible] = useState(() => localStorage.getItem(STORAGE_KEY) !== "hidden");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, visible ? "visible" : "hidden");
  }, [visible]);

  return (
    <section data-yance-workspace aria-label="Yance Workspace" hidden={!visible}>
      <header>
        <strong>Yance Workspace</strong>
        <button type="button" onClick={() => setVisible(false)} aria-label="Hide Yance Workspace">×</button>
      </header>
      <dl>
        <dt>AI</dt><dd>Conversation copilot</dd>
        <dt>Goal</dt><dd>Current conversation objective</dd>
        <dt>Contact</dt><dd>Unified customer context</dd>
        <dt>Presence</dt><dd>Channel and bridge presence</dd>
      </dl>
      {!visible && <button type="button" onClick={() => setVisible(true)}>Yance Workspace</button>}
    </section>
  );
}
