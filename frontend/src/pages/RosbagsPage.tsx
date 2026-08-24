import { useState } from "react";

import {
  DisabledControl,
  PressAndHoldButton,
  type CommandResult,
  ToastRegion,
  type ToastMessage,
} from "../components";
import { formatBytes } from "../format/bytes";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { CommandResponse } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";

type RecordingRow = {
  recording_id?: string;
  path?: string;
  size_bytes?: number;
  owner?: string;
  created_at?: string;
};

export type RosbagDownloadHandler = (recordingId: string) => Promise<CommandResult | void>;

export function RosbagsPage({
  state,
  dispatchCommand,
  downloadRecording,
}: {
  state: RuntimeStoreState;
  dispatchCommand: RuntimeCommandDispatcher;
  downloadRecording?: RosbagDownloadHandler;
}) {
  const rosbag = state.domains.rosbag;
  const [recordingId, setRecordingId] = useState("");
  const [allTopics, setAllTopics] = useState(true);
  const [topics, setTopics] = useState<string[]>([]);
  const [topicQuery, setTopicQuery] = useState("");
  const [includeHiddenTopics, setIncludeHiddenTopics] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const disabledReason = state.connection.commands_disabled_reason ?? undefined;
  const missionActive = state.domains.mission?.latest?.mission_active === true || state.domains.mission?.mission_state === "active";
  const owner = rosbag?.owner ?? ownerFromStatus(rosbag?.latest?.status) ?? "unknown";
  const ownerSensitiveStop = Boolean(rosbag?.recording) && !["manual", "gui", "unknown"].includes(owner);
  const startNeedsHold = missionActive;
  const stopNeedsHold = missionActive || ownerSensitiveStop;
  const recordings = recordingRows(state);
  const storageRoot = rosbag?.storage_root?.replace(/\/+$/, "") ?? "";
  const startDisabledReason = disabledReason ?? (!storageRoot ? "Configured rosbag storage root is unavailable." : undefined);
  const availableTopics = rosbag?.available_topics ?? [];
  const visibleTopics = availableTopics.filter((topic) => topic.toLowerCase().includes(topicQuery.trim().toLowerCase()));

  async function run(commandId: string, parameters?: Record<string, unknown>, successMessage?: string) {
    try {
      const response = await dispatchCommand(commandId, parameters);
      const result = commandResponseToResult(response, successMessage);
      setToasts((current) => [...current, { ...result, autoDismissMs: response.accepted ? 2400 : undefined }]);
      return response;
    } catch (error) {
      const result = errorToResult(commandId, error);
      setToasts((current) => [...current, result]);
      return null;
    }
  }

  function startParameters(holdConfirmed: boolean) {
    return {
      recording_id: recordingId.trim(),
      all_topics: allTopics,
      topics,
      include_hidden_topics: includeHiddenTopics,
      ...(holdConfirmed ? { hold_confirmed: true } : {}),
    };
  }

  function stopParameters(holdConfirmed: boolean) {
    return {
      recording_id: rosbag?.recording_id ?? "",
      timeout_sec: 5.0,
      ...(holdConfirmed ? { hold_confirmed: true } : {}),
    };
  }

  async function download(recording_id: string) {
    if (downloadRecording) {
      try {
        const result = await downloadRecording(recording_id);
        const notice =
          result ?? ({
            id: `download-${recording_id}`,
            severity: "success",
            title: "Download started",
            message: `Streaming ${recording_id} through the GC proxy.`,
          } satisfies CommandResult);
        setToasts((current) => [...current, { ...notice, autoDismissMs: 2400 }]);
      } catch (error) {
        const result = errorToResult(`rosbag.download.${recording_id}`, error);
        setToasts((current) => [...current, result]);
      }
      return;
    }
    await run("rosbag.download", { recording_id }, `Download ready for ${recording_id}`);
  }

  return (
    <div className="workflow-page rosbags-page">
      <section className="workflow-section">
        <h3>Recorder State</h3>
        <dl className="status-list">
          <div>
            <dt>Recording</dt>
            <dd>{rosbag?.recording ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt>Recording ID</dt>
            <dd>{rosbag?.recording_id ?? "none"}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{owner}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{rosbag?.output_dir ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(rosbag?.size_bytes)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(rosbag?.duration_seconds)}</dd>
          </div>
          <div>
            <dt>Free space</dt>
            <dd>{formatBytes(rosbag?.free_space_bytes)}</dd>
          </div>
        </dl>
        {rosbag?.recording_error ? <p className="control-reason" role="alert">{rosbag.recording_error}</p> : null}
        <p className="control-hint">Source: {rosbag?.source_label ?? "unknown"} / {rosbag?.freshness ?? "unknown"}</p>
      </section>

      <section className="workflow-section">
        <h3>Manual Recording</h3>
        <div className="rosbag-form">
          <label className="rosbag-name-field" htmlFor="rosbag-id">
            Recording path
            <span className="rosbag-name-composer">
              <code>{storageRoot || "unavailable"}/</code>
              <input id="rosbag-id" aria-label="Recording ID prefix" placeholder="recording" value={recordingId} onChange={(event) => setRecordingId(sanitizeRecordingPrefix(event.target.value))} />
              <code>_YYYYMMDD_HHMMSS</code>
            </span>
          </label>
          <div className="rosbag-topic-field">
            <label htmlFor="rosbag-topic-search">Search topics</label>
            <input
              id="rosbag-topic-search"
              type="search"
              disabled={allTopics}
              placeholder="Filter topics"
              value={topicQuery}
              onChange={(event) => setTopicQuery(event.target.value)}
            />
            <label htmlFor="rosbag-topics">Topics</label>
            <select
              id="rosbag-topics"
              multiple
              disabled={allTopics}
              value={topics}
              onChange={(event) => setTopics(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
            >
              {visibleTopics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
            </select>
          </div>
          <label className="check-field" htmlFor="rosbag-all-topics">
            <input id="rosbag-all-topics" type="checkbox" checked={allTopics} onChange={(event) => setAllTopics(event.target.checked)} />
            All topics
          </label>
          <label className="check-field" htmlFor="rosbag-hidden-topics">
            <input
              id="rosbag-hidden-topics"
              type="checkbox"
              checked={includeHiddenTopics}
              onChange={(event) => setIncludeHiddenTopics(event.target.checked)}
            />
            Hidden topics
          </label>
        </div>
        {startNeedsHold ? (
          <PressAndHoldButton
            label="Start recording"
            disabledReason={startDisabledReason}
            onConfirm={() => void run("rosbag.start", startParameters(true), "Rosbag recording started")}
          />
        ) : (
          <div className="inline-actions">
            <DisabledControl reason={startDisabledReason}>
            <button type="button" disabled={Boolean(startDisabledReason)} onClick={() => void run("rosbag.start", startParameters(false), "Rosbag recording started")}>
              Start recording
            </button>
            </DisabledControl>
          </div>
        )}
      </section>

      <section className="workflow-section">
        <h3>Stop Recording</h3>
        {stopNeedsHold ? (
          <PressAndHoldButton
            label="Stop recording"
            disabledReason={disabledReason}
            onConfirm={() => void run("rosbag.stop", stopParameters(true), "Rosbag recording stopped")}
          />
        ) : (
          <div className="inline-actions">
            <DisabledControl reason={disabledReason ?? (!rosbag?.recording ? "No rosbag recording is active." : undefined)}>
            <button
              type="button"
              disabled={Boolean(disabledReason) || !rosbag?.recording}
              onClick={() => void run("rosbag.stop", stopParameters(false), "Rosbag recording stopped")}
            >
              Stop recording
            </button>
            </DisabledControl>
          </div>
        )}
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Recordings</h3>
          <DisabledControl reason={disabledReason}><button type="button" disabled={Boolean(disabledReason)} onClick={() => void run("rosbag.list", undefined, "Rosbag recordings refreshed")}>
            Refresh list
          </button></DisabledControl>
        </div>
        <div className="recording-list">
          {recordings.map((recording) => (
            <article className="recording-row" key={recording.recording_id ?? recording.path}>
              <div>
                <strong>{recording.recording_id ?? "unnamed"}</strong>
                <p>{recording.path ?? "path unavailable"}</p>
              </div>
              <span>{formatBytes(recording.size_bytes)}</span>
              <span>{recording.owner ?? "unknown"}</span>
              <DisabledControl reason={disabledReason ?? (!recording.recording_id ? "Recording ID is unavailable." : undefined)}><button
                type="button"
                disabled={Boolean(disabledReason) || !recording.recording_id}
                onClick={() => recording.recording_id ? void download(recording.recording_id) : undefined}
              >
                Download
              </button></DisabledControl>
            </article>
          ))}
        </div>
      </section>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function recordingRows(state: RuntimeStoreState): RecordingRow[] {
  const rows = state.domains.rosbag?.latest?.recordings;
  return Array.isArray(rows) ? rows.map((row) => row as RecordingRow) : [];
}

function ownerFromStatus(status: unknown): string | null {
  if (!status || typeof status !== "object") {
    return null;
  }
  const owner = (status as { owner?: unknown }).owner;
  return typeof owner === "string" && owner ? owner : null;
}

function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) return "unknown";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function sanitizeRecordingPrefix(value: string): string {
  return Array.from(value, (character) => /[A-Za-z0-9_-]/.test(character) ? character : "_").join("");
}

function commandResponseToResult(response: CommandResponse, successMessage?: string): CommandResult {
  return {
    id: response.request_id,
    severity: response.accepted ? "success" : "danger",
    title: response.accepted ? "Command accepted" : "Command rejected",
    message: response.rejection?.message ?? response.message ?? successMessage ?? response.command_id,
    timestamp: response.timestamp,
  };
}

function errorToResult(commandId: string, error: unknown): CommandResult {
  return {
    id: `${commandId}-error`,
    severity: "danger",
    title: "Command failed",
    message: error instanceof Error ? error.message : String(error),
  };
}
