import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTranslationJob,
  createTranslationJob,
  readTranslationJob,
  retryTranslationJob,
  searchWorkspace,
} from "./experienceProjection";
import type {
  BilingualSearchResult,
  RelationshipProjection,
  TranslationJobProjection,
  WorkspaceSearchProjection,
} from "./experienceTypes";

const SEARCH_DEBOUNCE_MS = 260;
const JOB_POLL_MS = 700;
const ACTIVE_JOB_STATES = new Set(["queued", "running"]);
const RETRYABLE_JOB_STATES = new Set(["failed", "cancelled"]);

type BilingualSearchPanelProps = {
  relationships: readonly RelationshipProjection[];
  reducedMotion: boolean;
  onSelectRelationship: (relationshipId: string) => void;
  onNavigateRelationship?: (relationship: RelationshipProjection) => Promise<boolean>;
};

function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; reasonCode?: unknown; code?: unknown };
    const code = String(candidate.reasonCode || candidate.code || "").trim();
    const message = String(candidate.message || "").trim();
    if (code && message && message !== code) return `${message} (${code})`;
    if (code) return code;
    if (message) return message;
  }
  return fallback;
}

function normalizedStatus(job: TranslationJobProjection | null): string {
  return String(job?.status || "").trim().toLowerCase();
}

function formatTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(parsed));
  } catch {
    return value;
  }
}

function relationshipForResult(
  result: BilingualSearchResult,
  relationships: readonly RelationshipProjection[],
): RelationshipProjection | null {
  return relationships.find((relationship) => (
    relationship.id === result.contactId
    || (Boolean(result.conversationId) && relationship.sessionKey === result.conversationId)
  )) || null;
}

export function BilingualSearchPanel({
  relationships,
  reducedMotion,
  onSelectRelationship,
  onNavigateRelationship,
}: BilingualSearchPanelProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchProjection>({ query: "", contacts: [], messages: [] });
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [status, setStatus] = useState("Search messages in original text or Chinese translation.");
  const [activeMessageId, setActiveMessageId] = useState("");
  const [activeJob, setActiveJob] = useState<TranslationJobProjection | null>(null);
  const [jobTransportError, setJobTransportError] = useState("");
  const searchSequence = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeJobStatus = normalizedStatus(activeJob);
  const exactNavigationAvailableByMessage = useMemo(() => {
    const availability = new Map<string, boolean>();
    for (const result of results.messages) {
      const relationship = relationshipForResult(result, relationships);
      availability.set(
        result.messageId,
        Boolean(relationship?.matrixPermalink?.trim() || relationship?.matrixRoomId?.trim()),
      );
    }
    return availability;
  }, [relationships, results.messages]);

  const runSearch = async (nextQuery: string): Promise<void> => {
    const trimmed = nextQuery.trim();
    const sequence = ++searchSequence.current;
    if (!trimmed) {
      setSearchState("idle");
      setResults({ query: "", contacts: [], messages: [] });
      setStatus("Search messages in original text or Chinese translation.");
      return;
    }

    setSearchState("loading");
    setStatus(`Searching for “${trimmed}”…`);
    try {
      const next = await searchWorkspace(trimmed);
      if (sequence !== searchSequence.current) return;
      setResults(next);
      setSearchState("ready");
      const count = next.messages.length + next.contacts.length;
      setStatus(count ? `${count} search results ready.` : `No results for “${trimmed}”.`);
    } catch (error) {
      if (sequence !== searchSequence.current) return;
      setSearchState("error");
      setStatus(errorText(error, "Search is temporarily unavailable."));
    }
  };

  useEffect(() => {
    if (!expanded) return undefined;
    const trimmed = query.trim();
    if (!trimmed) {
      searchSequence.current += 1;
      setSearchState("idle");
      setResults({ query: "", contacts: [], messages: [] });
      setStatus("Search messages in original text or Chinese translation.");
      return undefined;
    }

    const timer = setTimeout(() => {
      void runSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [expanded, query]);

  useEffect(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    if (!activeJob || !ACTIVE_JOB_STATES.has(activeJobStatus)) return undefined;

    let disposed = false;
    const jobId = activeJob.id;
    const schedulePoll = (): void => {
      pollTimer.current = setTimeout(async () => {
        try {
          const next = await readTranslationJob(jobId);
          if (disposed) return;
          setActiveJob(next);
          setJobTransportError("");
          const nextStatus = normalizedStatus(next);
          setStatus(`Translation ${nextStatus || "updated"}: ${Math.round(next.progress)}%.`);
          if (ACTIVE_JOB_STATES.has(nextStatus)) {
            schedulePoll();
          } else if (nextStatus === "success" && query.trim()) {
            await runSearch(query);
          }
        } catch (error) {
          if (disposed) return;
          setJobTransportError(errorText(error, "Translation status is temporarily unavailable."));
          schedulePoll();
        }
      }, JOB_POLL_MS);
    };

    schedulePoll();
    return () => {
      disposed = true;
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [activeJob?.id, activeJobStatus]);

  const startTranslation = async (messageId: string): Promise<void> => {
    setActiveMessageId(messageId);
    setJobTransportError("");
    setStatus("Creating translation task…");
    try {
      const job = await createTranslationJob(messageId);
      setActiveJob(job);
      setStatus(`Translation ${normalizedStatus(job) || "queued"}: ${Math.round(job.progress)}%.`);
    } catch (error) {
      setJobTransportError(errorText(error, "Unable to create translation task."));
      setStatus(errorText(error, "Unable to create translation task."));
    }
  };

  const cancelActiveJob = async (): Promise<void> => {
    if (!activeJob?.id || !activeJob.cancellable) return;
    try {
      const job = await cancelTranslationJob(activeJob.id);
      setActiveJob(job);
      setJobTransportError("");
      setStatus("Translation cancelled.");
    } catch (error) {
      setJobTransportError(errorText(error, "Unable to cancel translation task."));
    }
  };

  const retryActiveJob = async (): Promise<void> => {
    if (!activeJob?.id || !RETRYABLE_JOB_STATES.has(activeJobStatus)) return;
    try {
      const job = await retryTranslationJob(activeJob.id);
      setActiveJob(job);
      setActiveMessageId(job.messageId || activeMessageId);
      setJobTransportError("");
      setStatus(`Translation ${normalizedStatus(job) || "queued"}: ${Math.round(job.progress)}%.`);
    } catch (error) {
      setJobTransportError(errorText(error, "Unable to retry translation task."));
    }
  };

  const navigateResult = async (result: BilingualSearchResult): Promise<void> => {
    const relationship = relationshipForResult(result, relationships);
    if (!relationship) {
      setStatus("This result has no available relationship context yet.");
      return;
    }

    const exactNavigationAvailable = Boolean(
      relationship.matrixPermalink?.trim() || relationship.matrixRoomId?.trim(),
    );
    if (exactNavigationAvailable && onNavigateRelationship) {
      try {
        const navigated = await onNavigateRelationship(relationship);
        if (navigated) {
          setStatus("Opened the authoritative Element conversation.");
          return;
        }
      } catch (error) {
        setStatus(errorText(error, "Element navigation is unavailable."));
      }
    }

    onSelectRelationship(relationship.id);
    setStatus("Opened relationship context. Exact Element message navigation is unavailable for this result.");
  };

  const clearSearch = (): void => {
    searchSequence.current += 1;
    setQuery("");
    setResults({ query: "", contacts: [], messages: [] });
    setSearchState("idle");
    setStatus("Search cleared.");
  };

  return (
    <section
      className="yance-bilingual-search"
      data-expanded={expanded || undefined}
      data-reduced-motion={reducedMotion || undefined}
      aria-label="Bilingual message search"
    >
      <div className="yance-bilingual-search__topline">
        <button
          type="button"
          className="yance-bilingual-search__toggle"
          aria-expanded={expanded}
          aria-controls="yance-bilingual-search-panel"
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">⌕</span>
          <span>Search / 搜索</span>
        </button>
        {expanded && query ? (
          <button type="button" className="yance-bilingual-search__quiet-action" onClick={clearSearch}>Clear</button>
        ) : null}
      </div>

      {expanded ? (
        <div id="yance-bilingual-search-panel" className="yance-bilingual-search__panel">
          <label className="yance-bilingual-search__field">
            <span className="yance-bilingual-search__label">Messages, names, or Chinese translation</span>
            <input
              type="search"
              value={query}
              autoComplete="off"
              placeholder="Search original text or 中文翻译"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void runSearch(query);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setExpanded(false);
                }
              }}
            />
          </label>

          <div className="yance-bilingual-search__status" aria-live="polite" aria-atomic="true">
            <span>{status}</span>
            {searchState === "loading" ? <span className="yance-bilingual-search__loading">Searching…</span> : null}
          </div>

          {jobTransportError ? (
            <div className="yance-bilingual-search__notice" role="alert">
              <strong>Translation status unavailable</strong>
              <span>{jobTransportError}</span>
            </div>
          ) : null}

          {activeJob ? (
            <div className="yance-bilingual-search__job" data-state={activeJobStatus}>
              <div className="yance-bilingual-search__job-heading">
                <span>Translation task</span>
                <strong>{activeJobStatus || activeJob.durableState || "unknown"}</strong>
              </div>
              <progress max={100} value={activeJob.progress} aria-label="Translation progress">
                {activeJob.progress}%
              </progress>
              <div className="yance-bilingual-search__job-meta">
                <span>{Math.round(activeJob.progress)}%</span>
                {activeJob.durableState ? <span>{activeJob.durableState}</span> : null}
                {activeJob.errorCode ? <span>{activeJob.errorCode}</span> : null}
              </div>
              {activeJob.error ? <p className="yance-bilingual-search__job-error">{activeJob.error}</p> : null}
              <div className="yance-bilingual-search__job-actions">
                {activeJob.cancellable ? (
                  <button type="button" onClick={() => void cancelActiveJob()}>Cancel</button>
                ) : null}
                {RETRYABLE_JOB_STATES.has(activeJobStatus) ? (
                  <button type="button" onClick={() => void retryActiveJob()}>Retry</button>
                ) : null}
              </div>
            </div>
          ) : null}

          {searchState === "ready" && results.contacts.length ? (
            <div className="yance-bilingual-search__contacts" aria-label="Matching people">
              <h3>People</h3>
              <div className="yance-bilingual-search__contact-list">
                {results.contacts.map((contact) => {
                  const relationship = relationships.find((row) => row.id === contact.contactId);
                  return (
                    <button
                      type="button"
                      key={`contact-${contact.id}`}
                      className="yance-bilingual-search__contact"
                      disabled={!relationship}
                      onClick={() => relationship && onSelectRelationship(relationship.id)}
                    >
                      <span>{contact.name || contact.phone || contact.contactId}</span>
                      {contact.platform ? <small>{contact.platform}</small> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {searchState === "ready" && results.messages.length ? (
            <ol className="yance-bilingual-search__results" aria-label="Matching messages">
              {results.messages.map((result) => {
                const exactNavigationAvailable = exactNavigationAvailableByMessage.get(result.messageId) === true;
                const selectedJob = activeMessageId === result.messageId ? activeJob : null;
                const hasTranslation = Boolean(result.translatedZh.trim());
                return (
                  <li key={result.messageId} className="yance-bilingual-search__result">
                    <div className="yance-bilingual-search__result-head">
                      <div>
                        <strong>{result.contactName || result.contactId || "Conversation"}</strong>
                        <span>{[result.platform, formatTime(result.sentAt)].filter(Boolean).join(" · ")}</span>
                      </div>
                      <span className="yance-bilingual-search__nav-state">
                        {exactNavigationAvailable ? "Element link" : "Relationship context"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="yance-bilingual-search__message"
                      onClick={() => void navigateResult(result)}
                      aria-label={`Open message from ${result.contactName || "conversation"}`}
                    >
                      <span className="yance-bilingual-search__original-label">Original</span>
                      <span className="yance-bilingual-search__original">{result.text || "No text content"}</span>
                      {hasTranslation ? (
                        <span className="yance-bilingual-search__translation">
                          <span>中文</span>
                          <span>{result.translatedZh}</span>
                        </span>
                      ) : null}
                    </button>
                    <div className="yance-bilingual-search__result-actions">
                      {!hasTranslation && !selectedJob ? (
                        <button type="button" onClick={() => void startTranslation(result.messageId)}>Translate to 中文</button>
                      ) : null}
                      {!exactNavigationAvailable ? <span>Exact message jump unavailable</span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {searchState === "ready" && !results.contacts.length && !results.messages.length ? (
            <div className="yance-bilingual-search__empty">
              <strong>No matching messages</strong>
              <span>Try a name, original phrase, or Chinese translation.</span>
            </div>
          ) : null}

          {searchState === "error" ? (
            <div className="yance-bilingual-search__empty">
              <strong>Search unavailable</strong>
              <span>Your query is preserved. Edit it or press Enter to retry.</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
