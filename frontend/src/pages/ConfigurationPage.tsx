import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import {
  PressAndHoldButton,
  ToastRegion,
  type CommandResult,
  type ToastMessage,
} from "../components";
import type { RuntimeCommandDispatcher } from "../api/commands";
import type { CommandResponse, ConfigurationManifest, ParameterDefinition, SnapshotSummary } from "../generated/contracts";
import type { RuntimeStoreState } from "../state";

type StagedEdit = {
  parameter: ParameterDefinition;
  valueText: string;
};

export function ConfigurationPage({
  state,
  dispatchCommand,
  onPendingEditsChange = () => undefined,
}: {
  state: RuntimeStoreState;
  dispatchCommand: RuntimeCommandDispatcher;
  onPendingEditsChange?: (pending: boolean) => void;
}) {
  const manifest = configurationManifest(state);
  const [query, setQuery] = useState("");
  const [staged, setStaged] = useState<Record<string, StagedEdit>>({});
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [overwriteSnapshotId, setOverwriteSnapshotId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const stagedEdits = Object.values(staged);
  const writeDisabledReason = configurationWriteDisabledReason(state);
  const downloadDisabledReason = state.connection.commands_disabled_reason ?? undefined;
  const badges = configurationBadges(manifest, state, stagedEdits.length > 0);
  const filteredNodes = filterNodes(manifest, query);
  const manifestUnavailableReason = configurationManifestUnavailableReason(state, manifest);

  useEffect(() => {
    onPendingEditsChange(stagedEdits.length > 0);
  }, [onPendingEditsChange, stagedEdits.length]);

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

  async function applyKeys(keys: string[]) {
    const edits = keys.map((key) => staged[key]).filter(Boolean);
    const validEdits = edits.filter((edit) => !validationError(edit.parameter, edit.valueText));
    if (validEdits.length === 0) {
      return;
    }
    const response = await run(
      "configuration.apply",
      { edits: validEdits.map((edit) => parameterEditPayload(edit.parameter, edit.valueText)) },
      `${validEdits.length} parameter edit${validEdits.length === 1 ? "" : "s"} applied`,
    );
    if (response?.accepted) {
      setStaged((current) => {
        const next = { ...current };
        keys.forEach((key) => delete next[key]);
        return next;
      });
    }
  }

  async function saveSnapshot(event: FormEvent) {
    event.preventDefault();
    const label = snapshotLabel.trim();
    if (!label) {
      return;
    }
    const existing = findSnapshot(manifest.available_snapshots, label);
    if (existing && overwriteSnapshotId !== existing.snapshot_id) {
      setOverwriteSnapshotId(existing.snapshot_id);
      return;
    }
    const parameters = existing ? { label, overwrite_snapshot_id: existing.snapshot_id } : { label };
    const response = await run("configuration.snapshot.save", parameters, `Snapshot ${label} saved`);
    if (response?.accepted) {
      setSnapshotLabel("");
      setOverwriteSnapshotId(null);
    }
  }

  const invalidEditCount = stagedEdits.filter((edit) => validationError(edit.parameter, edit.valueText)).length;

  return (
    <div className="workflow-page configuration-page">
      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Configuration Status</h3>
          <div className="badge-row">
            {badges.length > 0 ? badges.map((badge) => <span key={badge}>{badge}</span>) : <span>Clean</span>}
          </div>
        </div>
        <dl className="status-list">
          <div>
            <dt>Loaded snapshot</dt>
            <dd>{snapshotStatusLabel(manifest.status?.loaded_snapshot_id ?? state.domains.configuration?.active_snapshot_id, manifestUnavailableReason)}</dd>
          </div>
          <div>
            <dt>Default snapshot</dt>
            <dd>{snapshotStatusLabel(manifest.status?.default_snapshot_id, manifestUnavailableReason)}</dd>
          </div>
          <div>
            <dt>Pending edits</dt>
            <dd>{stagedEdits.length}</dd>
          </div>
          <div>
            <dt>Unsaved</dt>
            <dd>{manifest.status?.unsaved || state.domains.configuration?.unsaved ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt>Non-default</dt>
            <dd>{manifest.status?.non_default || state.domains.configuration?.non_default ? "yes" : "no"}</dd>
          </div>
        </dl>
        {state.domains.configuration?.degraded_reason ? <p className="control-reason">{state.domains.configuration.degraded_reason}</p> : null}
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Parameter Manifest</h3>
          <label className="compact-field" htmlFor="configuration-search">
            Search
            <input
              id="configuration-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="node, group, parameter"
            />
          </label>
        </div>
        {writeDisabledReason ? <p className="control-reason">{writeDisabledReason}</p> : null}
        {manifestUnavailableReason ? <p className="control-hint">{manifestUnavailableReason}</p> : null}
        <div className="parameter-browser">
          {filteredNodes.map((node) => (
            <section className="parameter-node" key={node.node_id}>
              <h4>{node.label}</h4>
              {node.groups?.map((group) => (
                <div className="parameter-group" key={group.group_id}>
                  <div className="parameter-group__heading">
                    <strong>{group.label}</strong>
                    <span>{restartSummary(group.parameters ?? [])}</span>
                  </div>
                  {(group.parameters ?? []).map((parameter) => {
                    const key = parameterKey(parameter);
                    const stagedEdit = staged[key];
                    const valueText = stagedEdit?.valueText ?? valueToInput(parameter.current_value, parameter.value_type);
                    const error = stagedEdit ? validationError(parameter, valueText) : null;
                    return (
                      <article className="parameter-row" key={key}>
                        <div>
                          <label htmlFor={parameterInputId(parameter)}>{parameter.name}</label>
                          <p>{parameter.description ?? `${parameter.value_type} parameter`}</p>
                          <div className="badge-row">
                            {parameter.restart_required && parameter.restart_required !== "none" ? (
                              <span>restart: {parameter.restart_required}</span>
                            ) : null}
                            {stagedEdit ? <span>Pending edits</span> : null}
                            {valueChanged(parameter.current_value, parameter.loaded_value) ? <span>Unsaved</span> : null}
                            {!valueChanged(parameter.current_value, parameter.loaded_value) && valueChanged(parameter.loaded_value, parameter.default_value) ? (
                              <span>Non-default</span>
                            ) : null}
                          </div>
                        </div>
                        {parameterInput(parameter, valueText, Boolean(writeDisabledReason), (nextValue) =>
                          setStaged((current) => ({ ...current, [key]: { parameter, valueText: nextValue } })),
                        )}
                        <div className="parameter-actions">
                          <button
                            type="button"
                            disabled={!stagedEdit || Boolean(error) || Boolean(writeDisabledReason)}
                            onClick={() => void applyKeys([key])}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            disabled={!stagedEdit}
                            onClick={() =>
                              setStaged((current) => {
                                const next = { ...current };
                                delete next[key];
                                return next;
                              })
                            }
                          >
                            Reset
                          </button>
                          {error ? <p className="control-reason">{error}</p> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ))}
            </section>
          ))}
        </div>
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Staged Edits</h3>
          <div className="inline-actions">
            <button
              type="button"
              disabled={stagedEdits.length === 0 || invalidEditCount > 0 || Boolean(writeDisabledReason)}
              onClick={() => void applyKeys(Object.keys(staged))}
            >
              Apply all
            </button>
            <button type="button" disabled={stagedEdits.length === 0} onClick={() => setStaged({})}>
              Reset all
            </button>
          </div>
        </div>
        <p className="control-hint">
          {stagedEdits.length} frontend-only edit{stagedEdits.length === 1 ? "" : "s"} staged
          {invalidEditCount > 0 ? `, ${invalidEditCount} invalid` : ""}.
        </p>
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Snapshots</h3>
          <button type="button" disabled={Boolean(downloadDisabledReason)} onClick={() => void run("configuration.snapshot.list", undefined, "Snapshot list refreshed")}>
            Refresh list
          </button>
        </div>
        <form className="inline-actions" onSubmit={saveSnapshot}>
          <label className="compact-field" htmlFor="snapshot-label">
            Snapshot label
            <input
              id="snapshot-label"
              value={snapshotLabel}
              onChange={(event) => {
                setSnapshotLabel(event.target.value);
                setOverwriteSnapshotId(null);
              }}
            />
          </label>
          <button type="submit" disabled={!snapshotLabel.trim() || Boolean(writeDisabledReason)}>
            Save snapshot
          </button>
          {overwriteSnapshotId ? (
            <button type="submit" disabled={Boolean(writeDisabledReason)}>
              Confirm overwrite
            </button>
          ) : null}
        </form>
        {overwriteSnapshotId ? <p className="control-reason">Overwrite existing snapshot {overwriteSnapshotId}?</p> : null}
        {runtimeActive(state) ? <p className="control-reason">Setting a default while runtime is active affects the next load or restart.</p> : null}
        <div className="snapshot-list">
          {(manifest.available_snapshots ?? []).map((snapshot) => (
            <article className="snapshot-row" key={snapshot.snapshot_id}>
              <div>
                <strong>{snapshot.label}</strong>
                <p>{snapshot.snapshot_id}</p>
                <div className="badge-row">
                  {snapshot.is_loaded ? <span>loaded</span> : null}
                  {snapshot.is_default ? <span>default</span> : null}
                </div>
              </div>
              <button
                type="button"
                disabled={Boolean(downloadDisabledReason)}
                onClick={() => void run("configuration.snapshot.download", { snapshot_id: snapshot.snapshot_id }, `Snapshot ${snapshot.label} downloaded`)}
              >
                Download
              </button>
              <PressAndHoldButton
                label="Load"
                disabledReason={writeDisabledReason}
                onConfirm={() => void run("configuration.snapshot.load", { snapshot_id: snapshot.snapshot_id }, `Snapshot ${snapshot.label} loaded`)}
              />
              <PressAndHoldButton
                label="Set default"
                disabledReason={writeDisabledReason}
                onConfirm={() => void run("configuration.snapshot.set_default", { snapshot_id: snapshot.snapshot_id }, `Snapshot ${snapshot.label} set as default`)}
              />
            </article>
          ))}
        </div>
      </section>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

function configurationManifest(state: RuntimeStoreState): ConfigurationManifest {
  const manifest = state.domains.configuration?.latest?.manifest;
  if (manifest && typeof manifest === "object") {
    return manifest as ConfigurationManifest;
  }
  return {
    nodes: [],
    available_snapshots: [],
    status: {
      pending_edits: false,
      unsaved: Boolean(state.domains.configuration?.unsaved),
      non_default: Boolean(state.domains.configuration?.non_default),
      loaded_snapshot_id: state.domains.configuration?.active_snapshot_id ?? null,
      default_snapshot_id: null,
      badges: [],
    },
  };
}

function configurationManifestUnavailableReason(state: RuntimeStoreState, manifest: ConfigurationManifest): string | null {
  if ((manifest.nodes ?? []).length > 0 || (manifest.available_snapshots ?? []).length > 0) {
    return null;
  }
  const reason = state.domains.configuration?.degraded_reason;
  if (reason) {
    return reason;
  }
  if (state.domains.configuration?.source_availability === "unavailable") {
    return "Configuration manifest is unavailable.";
  }
  return null;
}

function configurationBadges(
  manifest: ConfigurationManifest,
  state: RuntimeStoreState,
  hasFrontendEdits: boolean,
): string[] {
  const unsaved = Boolean(manifest.status?.unsaved || state.domains.configuration?.unsaved);
  const nonDefault = Boolean(manifest.status?.non_default || state.domains.configuration?.non_default);
  const badges: string[] = [];
  if (hasFrontendEdits) {
    badges.push("Pending edits");
  }
  if (unsaved) {
    badges.push("Unsaved");
  } else if (nonDefault) {
    badges.push("Non-default");
  }
  return badges;
}

function filterNodes(manifest: ConfigurationManifest, query: string): NonNullable<ConfigurationManifest["nodes"]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return manifest.nodes ?? [];
  }
  return (manifest.nodes ?? [])
    .map((node) => ({
      ...node,
      groups: (node.groups ?? [])
        .map((group) => ({
          ...group,
          parameters: (group.parameters ?? []).filter((parameter) =>
            [node.label, node.node_id, group.label, group.group_id, parameter.name, parameter.description, parameter.reference]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(normalized),
          ),
        }))
        .filter((group) => (group.parameters ?? []).length > 0),
    }))
    .filter((node) => (node.groups ?? []).length > 0);
}

function parameterInput(
  parameter: ParameterDefinition,
  valueText: string,
  disabled: boolean,
  onChange: (value: string) => void,
) {
  const common = {
    id: parameterInputId(parameter),
    disabled: disabled || parameter.readonly,
    value: valueText,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(event.target.value),
  };
  if (parameter.constraints?.choices?.length) {
    return (
      <select {...common}>
        {parameter.constraints.choices.map((choice) => (
          <option key={valueToInput(choice, parameter.value_type)} value={valueToInput(choice, parameter.value_type)}>
            {valueToInput(choice, parameter.value_type)}
          </option>
        ))}
      </select>
    );
  }
  if (parameter.value_type === "bool") {
    return (
      <select {...common}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      {...common}
      type={parameter.value_type === "integer" || parameter.value_type === "float" ? "number" : "text"}
      min={parameter.constraints?.minimum ?? undefined}
      max={parameter.constraints?.maximum ?? undefined}
      step={parameter.constraints?.step ?? (parameter.value_type === "integer" ? 1 : undefined)}
    />
  );
}

function parameterEditPayload(parameter: ParameterDefinition, valueText: string) {
  return {
    node_id: parameter.node_id,
    name: parameter.name,
    value: parseParameterValue(parameter, valueText),
  };
}

function parseParameterValue(parameter: ParameterDefinition, valueText: string): unknown {
  switch (parameter.value_type) {
    case "bool":
      return valueText === "true";
    case "integer":
      return Number.parseInt(valueText, 10);
    case "float":
      return Number(valueText);
    case "integer_array":
      return splitArray(valueText).map((value) => Number.parseInt(value, 10));
    case "float_array":
      return splitArray(valueText).map(Number);
    case "string_array":
      return splitArray(valueText);
    case "string":
    default:
      return valueText;
  }
}

function validationError(parameter: ParameterDefinition, valueText: string): string | null {
  if (parameter.readonly) {
    return "Parameter is read-only.";
  }
  const parsed = parseParameterValue(parameter, valueText);
  if ((parameter.value_type === "integer" || parameter.value_type === "float") && typeof parsed === "number") {
    if (!Number.isFinite(parsed)) {
      return "Value must be numeric.";
    }
    if (parameter.value_type === "integer" && !Number.isInteger(parsed)) {
      return "Value must be an integer.";
    }
    if (parameter.constraints?.minimum != null && parsed < parameter.constraints.minimum) {
      return `Value must be at least ${parameter.constraints.minimum}.`;
    }
    if (parameter.constraints?.maximum != null && parsed > parameter.constraints.maximum) {
      return `Value must be at most ${parameter.constraints.maximum}.`;
    }
  }
  if (parameter.value_type.endsWith("_array") && Array.isArray(parsed) && parsed.some((value) => typeof value === "number" && !Number.isFinite(value))) {
    return "Array contains an invalid number.";
  }
  if (parameter.constraints?.regex && typeof parsed === "string" && !new RegExp(parameter.constraints.regex).test(parsed)) {
    return "Value does not match the required pattern.";
  }
  return null;
}

function valueToInput(value: unknown, valueType: ParameterDefinition["value_type"]): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (valueType === "bool") {
    return value ? "true" : "false";
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function splitArray(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parameterKey(parameter: ParameterDefinition): string {
  return `${parameter.node_id}::${parameter.name}`;
}

function parameterInputId(parameter: ParameterDefinition): string {
  return `parameter-${parameterKey(parameter).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function restartSummary(parameters: ParameterDefinition[]): string {
  const nodeCount = parameters.filter((parameter) => parameter.restart_required === "node").length;
  const runtimeCount = parameters.filter((parameter) => parameter.restart_required === "runtime").length;
  if (nodeCount + runtimeCount === 0) {
    return "no restart";
  }
  return `${nodeCount} node / ${runtimeCount} runtime restart`;
}

function valueChanged(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
}

function findSnapshot(snapshots: SnapshotSummary[] | undefined, label: string): SnapshotSummary | undefined {
  return snapshots?.find((snapshot) => snapshot.label === label || snapshot.snapshot_id === label || snapshot.snapshot_id.endsWith(`/${label}.yaml`));
}

function configurationWriteDisabledReason(state: RuntimeStoreState): string | undefined {
  if (state.connection.commands_disabled_reason) {
    return state.connection.commands_disabled_reason;
  }
  if (state.domains.mission?.latest?.mission_active === true || state.domains.mission?.mission_state === "active") {
    return "configuration writes are disabled in Mission mode";
  }
  if (state.domains.operation?.latest?.operation_active === true || state.domains.operation?.active_operation_id) {
    return "configuration writes are disabled while a custom operation action is active";
  }
  const permissions = state.domains.configuration?.latest?.permissions;
  if (permissions && typeof permissions === "object") {
    const allowed = (permissions as { writes_allowed?: unknown }).writes_allowed;
    const rejections = (permissions as { write_rejections?: unknown }).write_rejections;
    if (allowed === false && Array.isArray(rejections) && rejections.length > 0) {
      return rejections.map(String).join("; ");
    }
  }
  return undefined;
}

function snapshotStatusLabel(value: string | null | undefined, unavailableReason: string | null): string {
  if (value) {
    return value;
  }
  return unavailableReason ? "unavailable" : "none";
}

function runtimeActive(state: RuntimeStoreState): boolean {
  return state.domains.system?.active === true || state.domains.system?.booted === true;
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
