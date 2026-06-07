import { useEffect, useMemo, useRef, useState } from "react";

import type { LogFollowHandle, LogLine, LogSourceSummary, RuntimeLogsClient } from "../api/logs";
import { CommandResultNotice, type CommandResult } from "../components";
import type { RuntimeStoreState } from "../state";

const DEFAULT_SOURCES: LogSourceSummary[] = [
  { source_id: "daemon", label: "III system daemon", kind: "journal" },
  { source_id: "runtime_api", label: "III runtime API", kind: "journal" },
  { source_id: "all", label: "All logs", kind: "aggregate" },
];

export function LogsPage({
  state,
  authenticated = state.connection.connected,
  logsClient,
  initialSources = DEFAULT_SOURCES,
  initialLines = [],
}: {
  state: RuntimeStoreState;
  authenticated?: boolean;
  logsClient?: RuntimeLogsClient;
  initialSources?: LogSourceSummary[];
  initialLines?: LogLine[];
}) {
  const [sources, setSources] = useState<LogSourceSummary[]>(initialSources);
  const [activeSourceId, setActiveSourceId] = useState(initialSources[0]?.source_id ?? "all");
  const [lines, setLines] = useState<LogLine[]>(initialLines);
  const [query, setQuery] = useState("");
  const [tailLines, setTailLines] = useState(200);
  const [following, setFollowing] = useState(false);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);
  const followHandleRef = useRef<LogFollowHandle | null>(null);
  const activeSource = sources.find((source) => source.source_id === activeSourceId) ?? sources[0];

  useEffect(() => {
    if (!authenticated || !logsClient) {
      return;
    }
    let active = true;
    logsClient
      .listSources()
      .then((nextSources) => {
        if (!active) {
          return;
        }
        setSources(nextSources);
        setActiveSourceId((current) => nextSources.some((source) => source.source_id === current) ? current : (nextSources[0]?.source_id ?? "all"));
      })
      .catch((error: unknown) => setLastResult(errorResult("Source load failed", error)));
    return () => {
      active = false;
    };
  }, [authenticated, logsClient]);

  useEffect(() => {
    if (!authenticated || !logsClient || !activeSourceId) {
      return;
    }
    let active = true;
    logsClient
      .tail(activeSourceId, tailLines)
      .then((nextLines) => {
        if (active) {
          setLines(nextLines);
        }
      })
      .catch((error: unknown) => setLastResult(errorResult("Log tail failed", error)));
    return () => {
      active = false;
    };
  }, [activeSourceId, authenticated, logsClient, tailLines]);

  useEffect(() => () => stopFollow(), []);

  const filteredLines = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return lines;
    }
    return lines.filter((line) => `${line.source_label} ${line.source_id} ${line.line}`.toLowerCase().includes(normalized));
  }, [lines, query]);

  if (!authenticated) {
    return (
      <div className="workflow-page logs-page">
        <section className="workflow-section">
          <h3>Logs</h3>
          <p className="control-reason">Login required to access runtime logs.</p>
        </section>
      </div>
    );
  }

  function selectSource(sourceId: string) {
    stopFollow();
    setActiveSourceId(sourceId);
  }

  function stopFollow() {
    followHandleRef.current?.close();
    followHandleRef.current = null;
    setFollowing(false);
  }

  function startFollow() {
    if (!logsClient || !activeSource) {
      setLastResult({
        id: "logs-follow-unavailable",
        severity: "danger",
        title: "Follow unavailable",
        message: "Log follow is not connected to the runtime API.",
      });
      return;
    }
    stopFollow();
    followHandleRef.current = logsClient.follow(
      activeSource.source_id,
      (line) => setLines((current) => [...current, line].slice(-1000)),
      (message) =>
        setLastResult({
          id: "logs-follow-error",
          severity: "danger",
          title: "Follow failed",
          message,
        }),
    );
    setFollowing(true);
  }

  async function exportCurrentView() {
    if (!logsClient || !activeSource) {
      setLastResult({
        id: "logs-export-unavailable",
        severity: "danger",
        title: "Export unavailable",
        message: "Log export is not connected to the runtime API.",
      });
      return;
    }
    try {
      const content = await logsClient.download(activeSource.source_id);
      setLastResult({
        id: `logs-export-${activeSource.source_id}`,
        severity: "success",
        title: "Export ready",
        message: `${activeSource.label}: ${content.length} bytes`,
      });
    } catch (error) {
      setLastResult(errorResult("Export failed", error));
    }
  }

  return (
    <div className="workflow-page logs-page">
      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Log Sources</h3>
          <div className="inline-actions">
            <button type="button" onClick={() => logsClient?.listSources().then(setSources)}>
              Refresh sources
            </button>
            <button type="button" onClick={() => logsClient?.tail(activeSourceId, tailLines).then(setLines)}>
              Refresh history
            </button>
          </div>
        </div>
        <div className="log-source-list">
          {sources.map((source) => (
            <button
              type="button"
              key={source.source_id}
              className={source.source_id === activeSourceId ? "log-source log-source--active" : "log-source"}
              onClick={() => selectSource(source.source_id)}
            >
              <strong>{source.label}</strong>
              <span>{source.source_id} / {source.kind}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>{activeSource?.label ?? "Logs"}</h3>
          <div className="inline-actions">
            <label className="compact-field" htmlFor="log-lines">
              Lines
              <input id="log-lines" type="number" min={20} max={1000} value={tailLines} onChange={(event) => setTailLines(Number(event.target.value))} />
            </label>
            <label className="compact-field" htmlFor="log-search">
              Search
              <input id="log-search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            {following ? (
              <button type="button" onClick={stopFollow}>
                Stop follow
              </button>
            ) : (
              <button type="button" onClick={startFollow}>
                Follow
              </button>
            )}
            <button type="button" onClick={() => void exportCurrentView()}>
              Export current view
            </button>
          </div>
        </div>
        <div className="log-lines" role="log" aria-label="Runtime log lines">
          {filteredLines.length > 0 ? (
            filteredLines.map((line, index) => (
              <pre key={`${line.source_id}-${index}`}>
                <span>[{line.source_label || line.source_id}]</span> {line.line}
              </pre>
            ))
          ) : (
            <p className="log-lines__empty">
              No log lines available for {activeSource?.label ?? activeSourceId}. Refresh history or select another source.
            </p>
          )}
        </div>
      </section>

      {lastResult ? <CommandResultNotice result={lastResult} /> : null}
    </div>
  );
}

function errorResult(title: string, error: unknown): CommandResult {
  return {
    id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-error`,
    severity: "danger",
    title,
    message: error instanceof Error ? error.message : String(error),
  };
}
