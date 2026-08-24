import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import {
  DisabledControl,
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
  onOpenRuntime = () => undefined,
}: {
  state: RuntimeStoreState;
  dispatchCommand: RuntimeCommandDispatcher;
  onPendingEditsChange?: (pending: boolean) => void;
  onOpenRuntime?: () => void;
}) {
  const manifest = configurationManifest(state);
  const [query, setQuery] = useState("");
  const [nodeFilter, setNodeFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [mutabilityFilter, setMutabilityFilter] = useState("all");
  const [staged, setStaged] = useState<Record<string, StagedEdit>>({});
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [overwriteSnapshotId, setOverwriteSnapshotId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const stagedEdits = Object.values(staged);
  const writeDisabledReason = configurationWriteDisabledReason(state);
  const downloadDisabledReason = state.connection.commands_disabled_reason ?? undefined;
  const badges = configurationBadges(manifest, state, stagedEdits.length > 0);
  const rows = parameterRows(manifest);
  const filteredRows = filterParameterRows(rows, query, nodeFilter, groupFilter, mutabilityFilter);
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
  const blockedEditCount = stagedEdits.filter((edit) => parameterApplyDisabledReason(edit.parameter, state)).length;

  return (
    <div className="workflow-page configuration-page">
      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Configuration Status</h3>
          <div className="badge-row">
            {badges.length > 0 ? badges.map((badge) => <span key={badge}>{badge}</span>) : <span>Clean</span>}
          </div>
        </div>
        <dl className="status-list configuration-status-list">
          <div>
            <dt>Loaded snapshot</dt>
            <dd>{snapshotStatusLabel(manifest.status?.loaded_snapshot_id ?? state.domains.configuration?.active_snapshot_id, manifestUnavailableReason)}</dd>
          </div>
          <div>
            <dt>Default snapshot</dt>
            <dd>{snapshotStatusLabel(manifest.status?.default_snapshot_id, manifestUnavailableReason)}</dd>
          </div>
          <div>
            <dt>Configuration server</dt>
            <dd>{manifest.status?.configuration_server_available ? "available" : "unavailable"}</dd>
          </div>
          <div>
            <dt>Pending edits</dt>
            <dd>{stagedEdits.length}</dd>
          </div>
          <div>
            <dt>Restart required</dt>
            <dd>{manifest.status?.pending_restart ? "yes" : "no"}</dd>
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
        {manifest.status?.pending_restart ? (
          <div className="control-callout">
            <strong>Only valid after system restart</strong>
            <p>{(manifest.status.pending_constant_names ?? []).join(", ") || "Constant parameter changes are persisted."}</p>
            <button type="button" onClick={onOpenRuntime}>Open Runtime</button>
          </div>
        ) : null}
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
        {manifestUnavailableReason ? <p className="control-hint">{manifestUnavailableReason}</p> : null}
        <div className="parameter-table-tools">
          <label>Node<select value={nodeFilter} onChange={(event) => setNodeFilter(event.target.value)}><option value="all">All nodes</option>{uniqueOptions(rows.map((row) => row.nodeLabel)).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Group/category<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="all">All groups</option>{uniqueOptions(rows.map((row) => row.groupLabel)).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Mutability<select value={mutabilityFilter} onChange={(event) => setMutabilityFilter(event.target.value)}><option value="all">All</option><option value="constant">Constant</option><option value="runtime">Runtime-editable</option><option value="readonly">Read-only</option></select></label>
          <span aria-label="Parameter result count">{filteredRows.length} of {rows.length} parameters</span>
        </div>
        <div className="table-scroll parameter-table-scroll" tabIndex={0} aria-label="Parameter table scroll region">
          <table className="data-table parameter-table">
            <thead><tr><th>Parameter</th><th>Node</th><th>Group/category</th><th>Type</th><th>Active</th><th>Persisted</th><th>Edit value</th><th>Flags/policy</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredRows.map(({ nodeLabel, groupLabel, parameter }) => {
                    const key = parameterKey(parameter);
                    const stagedEdit = staged[key];
                    const valueText = stagedEdit?.valueText ?? valueToInput(parameter.current_value, parameter.value_type);
                    const error = stagedEdit ? validationError(parameter, valueText) : null;
                    const parameterDisabledReason = parameterApplyDisabledReason(parameter, state);
                    const activeValue = parameter.active_value ?? parameter.current_value;
                    const persistedValue = parameter.persisted_value ?? activeValue;
                    const applyReason = !stagedEdit ? "No local edit to apply." : error ?? parameterDisabledReason;
                    return <tr key={key}>
                      <td><details><summary><label htmlFor={parameterInputId(parameter)}>{parameter.name}</label></summary><dl className="parameter-detail"><div><dt>Description</dt><dd>{parameter.description ?? "none"}</dd></div><div><dt>Default</dt><dd>{valueToInput(parameter.default_value, parameter.value_type)}</dd></div><div><dt>Loaded</dt><dd>{valueToInput(parameter.loaded_value, parameter.value_type)}</dd></div><div><dt>Constraints</dt><dd>{parameterConstraintSummary(parameter)}</dd></div><div><dt>Reference</dt><dd>{parameter.reference ?? "none"}</dd></div>{parameter.apply_rejection_reasons?.length ? <div><dt>Apply rejection</dt><dd>{parameter.apply_rejection_reasons.join("; ")}</dd></div> : null}</dl></details></td>
                      <td>{nodeLabel}</td><td>{groupLabel}</td><td>{parameter.value_type}</td>
                      <td>{valueToInput(activeValue, parameter.value_type)}</td><td>{valueToInput(persistedValue, parameter.value_type)}</td>
                      <td>{parameterInput(parameter, valueText, Boolean(parameterDisabledReason), (nextValue) =>
                          setStaged((current) => ({ ...current, [key]: { parameter, valueText: nextValue } })),
                        )}{error ? <p className="control-reason">{error}</p> : null}</td>
                      <td><div className="status-tags">{parameterFlags(parameter, stagedEdit, activeValue, persistedValue).map((flag) => <span key={flag}>{flag}</span>)}</div></td>
                      <td><div className="parameter-actions">
                          <DisabledControl reason={applyReason}><button type="button" disabled={Boolean(applyReason)} onClick={() => void applyKeys([key])}>Apply</button></DisabledControl>
                          <DisabledControl reason={!stagedEdit ? "No local edit to reset." : undefined}><button type="button" disabled={!stagedEdit} onClick={() =>
                              setStaged((current) => {
                                const next = { ...current };
                                delete next[key];
                                return next;
                              })}>Reset</button></DisabledControl>
                        </div></td>
                    </tr>;
              })}
              {filteredRows.length === 0 ? <tr><td colSpan={9}>No parameters match current search and filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Staged Edits</h3>
          <div className="inline-actions">
            <button
              type="button"
              disabled={stagedEdits.length === 0 || invalidEditCount > 0 || blockedEditCount > 0}
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
          {blockedEditCount > 0 ? ` ${blockedEditCount} blocked by the current system/flight gate.` : ""}
        </p>
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading">
          <h3>Snapshots</h3>
          <DisabledControl reason={downloadDisabledReason}><button type="button" disabled={Boolean(downloadDisabledReason)} onClick={() => void run("configuration.snapshot.list", undefined, "Snapshot list refreshed")}>
            Refresh list
          </button></DisabledControl>
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
          <DisabledControl reason={writeDisabledReason ?? (!snapshotLabel.trim() ? "Enter a snapshot label." : undefined)}><button type="submit" disabled={!snapshotLabel.trim() || Boolean(writeDisabledReason)}>
            Save snapshot
          </button></DisabledControl>
          {overwriteSnapshotId ? (
            <DisabledControl reason={writeDisabledReason}><button type="submit" disabled={Boolean(writeDisabledReason)}>
              Confirm overwrite
            </button></DisabledControl>
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
              <DisabledControl reason={downloadDisabledReason}><button
                type="button"
                disabled={Boolean(downloadDisabledReason)}
                onClick={() => void run("configuration.snapshot.download", { snapshot_id: snapshot.snapshot_id }, `Snapshot ${snapshot.label} downloaded`)}
              >
                Download
              </button></DisabledControl>
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
      configuration_server_available: false,
      pending_restart: false,
      pending_constant_names: [],
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
  if (manifest.status?.pending_restart) {
    badges.push("Restart required");
  }
  if (unsaved) {
    badges.push("Unsaved");
  } else if (nonDefault) {
    badges.push("Non-default");
  }
  return badges;
}

type ParameterRow = { nodeLabel: string; groupLabel: string; parameter: ParameterDefinition };

function parameterRows(manifest: ConfigurationManifest): ParameterRow[] {
  return (manifest.nodes ?? []).flatMap((node) => (node.groups ?? []).flatMap((group) => (group.parameters ?? []).map((parameter) => ({
    nodeLabel: node.label || node.node_id,
    groupLabel: group.label || group.group_id,
    parameter,
  }))));
}

function filterParameterRows(rows: ParameterRow[], query: string, node: string, group: string, mutability: string): ParameterRow[] {
  const normalized = query.trim().toLowerCase();
  return rows.filter((row) => {
    const parameter = row.parameter;
    const flags = parameterFlags(parameter, undefined, parameter.active_value ?? parameter.current_value, parameter.persisted_value ?? parameter.current_value);
    const searchable = [row.nodeLabel, parameter.node_id, row.groupLabel, parameter.group_id, parameter.name, parameter.description, parameter.value_type, parameter.reference, flags.join(" "), ...(parameter.constraints?.choices ?? []).map(String)].filter(Boolean).join(" ").toLowerCase();
    const mutabilityMatches = mutability === "all" || (mutability === "constant" && parameter.constant) || (mutability === "readonly" && parameter.readonly) || (mutability === "runtime" && !parameter.constant && !parameter.readonly);
    return (!normalized || searchable.includes(normalized)) && (node === "all" || row.nodeLabel === node) && (group === "all" || row.groupLabel === group) && mutabilityMatches;
  });
}

function uniqueOptions(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parameterFlags(parameter: ParameterDefinition, stagedEdit: StagedEdit | undefined, activeValue: unknown, persistedValue: unknown): string[] {
  const flags = [parameter.readonly ? "read-only" : parameter.constant ? "constant" : "runtime-editable"];
  if (parameter.restart_required && parameter.restart_required !== "none") flags.push(`restart: ${parameter.restart_required}`);
  if (stagedEdit) flags.push("pending");
  if (valueChanged(activeValue, persistedValue)) flags.push("restart required");
  if (valueChanged(parameter.current_value, parameter.loaded_value)) flags.push("unsaved");
  else if (valueChanged(parameter.loaded_value, parameter.default_value)) flags.push("non-default");
  if (parameter.apply_allowed === false) flags.push("apply blocked");
  return flags;
}

function parameterConstraintSummary(parameter: ParameterDefinition): string {
  const constraints = parameter.constraints;
  if (!constraints) return "none";
  return [
    constraints.unit ? `unit ${constraints.unit}` : null,
    constraints.minimum != null ? `min ${constraints.minimum}` : null,
    constraints.maximum != null ? `max ${constraints.maximum}` : null,
    constraints.step != null ? `step ${constraints.step}` : null,
    constraintExpressionSummary(parameter),
    constraints.choices?.length ? `choices ${constraints.choices.map(String).join(", ")}` : null,
    constraints.regex ? `pattern ${constraints.regex}` : null,
  ].filter(Boolean).join("; ") || "none";
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

function constraintExpressionSummary(parameter: ParameterDefinition): string | null {
  const expressions = [
    parameter.constraints?.minimum_expression ? `min ${parameter.constraints.minimum_expression}` : null,
    parameter.constraints?.maximum_expression ? `max ${parameter.constraints.maximum_expression}` : null,
    parameter.constraints?.step_expression ? `step ${parameter.constraints.step_expression}` : null,
  ].filter(Boolean);
  return expressions.length > 0 ? `Server constraint: ${expressions.join(", ")}` : null;
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

function parameterApplyDisabledReason(parameter: ParameterDefinition, state: RuntimeStoreState): string | undefined {
  if (state.connection.commands_disabled_reason) {
    return state.connection.commands_disabled_reason;
  }
  if (parameter.readonly) {
    return "Parameter is read-only.";
  }
  if (parameter.apply_allowed === false) {
    return (parameter.apply_rejection_reasons ?? []).join("; ") || "Parameter update is not allowed in the current state.";
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
