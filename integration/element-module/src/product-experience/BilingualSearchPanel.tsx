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
const MAX_POLL_FAILURES = 5;
const MAX_POLL_BACKOFF_MS = 10_000;
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

function translationStatusLabel(status: string): string {
  if (status === "queued") return "排队中";
  if (status === "running") return "进行中";
  if (status === "success") return "已完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  return status || "已更新";
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
  const [status, setStatus] = useState("搜索原文、姓名或中文翻译。");
  const [activeMessageId, setActiveMessageId] = useState("");
  const [activeJob, setActiveJob] = useState<TranslationJobProjection | null>(null);
  const [jobTransportError, setJobTransportError] = useState("");
  const searchSequence = useRef(0);
  const translationSequence = useRef(0);
  const latestQuery = useRef("");
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestQuery.current = query;
  }, [query]);

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
      setStatus("搜索原文、姓名或中文翻译。");
      return;
    }

    setSearchState("loading");
    setStatus(`正在搜索“${trimmed}”…`);
    try {
      const next = await searchWorkspace(trimmed);
      if (sequence !== searchSequence.current) return;
      setResults(next);
      setSearchState("ready");
      const count = next.messages.length + next.contacts.length;
      setStatus(count ? `找到 ${count} 条结果。` : `没有找到“${trimmed}”的结果。`);
    } catch (error) {
      if (sequence !== searchSequence.current) return;
      setSearchState("error");
      setStatus(errorText(error, "搜索暂不可用。"));
    }
  };

  useEffect(() => {
    if (!expanded) return undefined;
    const trimmed = query.trim();
    if (!trimmed) {
      searchSequence.current += 1;
      setSearchState("idle");
      setResults({ query: "", contacts: [], messages: [] });
      setStatus("搜索原文、姓名或中文翻译。");
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
    let failures = 0;
    const jobId = activeJob.id;
    const schedulePoll = (delay = JOB_POLL_MS): void => {
      pollTimer.current = setTimeout(async () => {
        try {
          const next = await readTranslationJob(jobId);
          if (disposed) return;
          failures = 0;
          setActiveJob(next);
          setJobTransportError("");
          const nextStatus = normalizedStatus(next);
          setStatus(`翻译${translationStatusLabel(nextStatus)}：${Math.round(next.progress)}%。`);
          if (ACTIVE_JOB_STATES.has(nextStatus)) {
            schedulePoll();
          } else if (nextStatus === "success" && latestQuery.current.trim()) {
            await runSearch(latestQuery.current);
          }
        } catch (error) {
          if (disposed) return;
          failures += 1;
          setJobTransportError(errorText(error, "翻译状态暂不可用。"));
          if (failures >= MAX_POLL_FAILURES) {
            setStatus("连续连接失败，已暂停轮询翻译状态。你可以稍后重试。 ");
            return;
          }
          schedulePoll(Math.min(JOB_POLL_MS * (2 ** failures), MAX_POLL_BACKOFF_MS));
        }
      }, delay);
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
    const sequence = ++translationSequence.current;
    setActiveMessageId(messageId);
    setActiveJob(null);
    setJobTransportError("");
    setStatus("正在创建翻译任务…");
    try {
      const job = await createTranslationJob(messageId);
      if (sequence !== translationSequence.current) return;
      setActiveJob(job);
      setStatus(`翻译${translationStatusLabel(normalizedStatus(job) || "queued")}：${Math.round(job.progress)}%。`);
    } catch (error) {
      if (sequence !== translationSequence.current) return;
      setActiveJob(null);
      setJobTransportError(errorText(error, "无法创建翻译任务。"));
      setStatus(errorText(error, "无法创建翻译任务。"));
    }
  };

  const cancelActiveJob = async (): Promise<void> => {
    if (!activeJob?.id || !activeJob.cancellable) return;
    try {
      const job = await cancelTranslationJob(activeJob.id);
      setActiveJob(job);
      setJobTransportError("");
      setStatus("翻译已取消。");
    } catch (error) {
      setJobTransportError(errorText(error, "无法取消翻译任务。"));
    }
  };

  const retryActiveJob = async (): Promise<void> => {
    if (!activeJob?.id || !RETRYABLE_JOB_STATES.has(activeJobStatus)) return;
    try {
      const job = await retryTranslationJob(activeJob.id);
      setActiveJob(job);
      setActiveMessageId(job.messageId || activeMessageId);
      setJobTransportError("");
      setStatus(`翻译${translationStatusLabel(normalizedStatus(job) || "queued")}：${Math.round(job.progress)}%。`);
    } catch (error) {
      setJobTransportError(errorText(error, "无法重试翻译任务。"));
    }
  };

  const navigateResult = async (result: BilingualSearchResult): Promise<void> => {
    const relationship = relationshipForResult(result, relationships);
    if (!relationship) {
      setStatus("这条结果暂时没有可用的关系上下文。");
      return;
    }

    const exactNavigationAvailable = Boolean(
      relationship.matrixPermalink?.trim() || relationship.matrixRoomId?.trim(),
    );
    let navigationError = "";
    if (exactNavigationAvailable && onNavigateRelationship) {
      try {
        const navigated = await onNavigateRelationship(relationship);
        if (navigated) {
          setStatus("已打开可信的 Element 会话。");
          return;
        }
      } catch (error) {
        navigationError = errorText(error, "Element 导航暂不可用。");
      }
    }

    onSelectRelationship(relationship.id);
    setStatus(navigationError
      ? `已打开关系上下文。Element 导航失败：${navigationError}`
      : "已打开关系上下文；这条结果暂时无法精确跳转到 Element 消息。 ");
  };

  const clearSearch = (): void => {
    searchSequence.current += 1;
    setQuery("");
    setResults({ query: "", contacts: [], messages: [] });
    setSearchState("idle");
    setStatus("搜索已清除。");
  };

  return (
    <section
      className="yance-bilingual-search"
      data-expanded={expanded || undefined}
      data-reduced-motion={reducedMotion || undefined}
      aria-label="双语消息搜索"
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
          <span>搜索</span>
        </button>
        {expanded && query ? (
          <button type="button" className="yance-bilingual-search__quiet-action" onClick={clearSearch}>清除</button>
        ) : null}
      </div>

      {expanded ? (
        <div id="yance-bilingual-search-panel" className="yance-bilingual-search__panel">
          <label className="yance-bilingual-search__field">
            <span className="yance-bilingual-search__label">消息、姓名或中文翻译</span>
            <input
              type="search"
              value={query}
              autoComplete="off"
              placeholder="搜索原文或中文翻译"
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
            {searchState === "loading" ? <span className="yance-bilingual-search__loading">正在搜索…</span> : null}
          </div>

          {jobTransportError ? (
            <div className="yance-bilingual-search__notice" role="alert">
              <strong>翻译状态暂不可用</strong>
              <span>{jobTransportError}</span>
            </div>
          ) : null}

          {activeJob ? (
            <div className="yance-bilingual-search__job" data-state={activeJobStatus}>
              <div className="yance-bilingual-search__job-heading">
                <span>翻译任务</span>
                <strong>{translationStatusLabel(activeJobStatus || activeJob.durableState || "")}</strong>
              </div>
              <progress max={100} value={activeJob.progress} aria-label="翻译进度">
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
                  <button type="button" onClick={() => void cancelActiveJob()}>取消</button>
                ) : null}
                {RETRYABLE_JOB_STATES.has(activeJobStatus) ? (
                  <button type="button" onClick={() => void retryActiveJob()}>重试</button>
                ) : null}
              </div>
            </div>
          ) : null}

          {searchState === "ready" && results.contacts.length ? (
            <div className="yance-bilingual-search__contacts" aria-label="匹配联系人">
              <h3>联系人</h3>
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
            <ol className="yance-bilingual-search__results" aria-label="匹配消息">
              {results.messages.map((result) => {
                const exactNavigationAvailable = exactNavigationAvailableByMessage.get(result.messageId) === true;
                const selectedJob = activeMessageId === result.messageId ? activeJob : null;
                const hasTranslation = Boolean(result.translatedZh.trim());
                return (
                  <li key={result.messageId} className="yance-bilingual-search__result">
                    <div className="yance-bilingual-search__result-head">
                      <div>
                        <strong>{result.contactName || result.contactId || "会话"}</strong>
                        <span>{[result.platform, formatTime(result.sentAt)].filter(Boolean).join(" · ")}</span>
                      </div>
                      <span className="yance-bilingual-search__nav-state">
                        {exactNavigationAvailable ? "Element 可定位" : "关系上下文"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="yance-bilingual-search__message"
                      onClick={() => void navigateResult(result)}
                      aria-label={`打开来自 ${result.contactName || "会话"} 的消息`}
                    >
                      <span className="yance-bilingual-search__original-label">原文</span>
                      <span className="yance-bilingual-search__original">{result.text || "暂无文本内容"}</span>
                      {hasTranslation ? (
                        <span className="yance-bilingual-search__translation">
                          <span>中文</span>
                          <span>{result.translatedZh}</span>
                        </span>
                      ) : null}
                    </button>
                    <div className="yance-bilingual-search__result-actions">
                      {!hasTranslation && !selectedJob ? (
                        <button type="button" onClick={() => void startTranslation(result.messageId)}>翻译成中文</button>
                      ) : null}
                      {!exactNavigationAvailable ? <span>暂无法精确跳转到消息</span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {searchState === "ready" && !results.contacts.length && !results.messages.length ? (
            <div className="yance-bilingual-search__empty">
              <strong>没有匹配消息</strong>
              <span>可以尝试联系人姓名、原文片段或中文翻译。</span>
            </div>
          ) : null}

          {searchState === "error" ? (
            <div className="yance-bilingual-search__empty">
              <strong>搜索暂不可用</strong>
              <span>查询内容已保留；可以修改后重试，或按 Enter 再次搜索。</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
