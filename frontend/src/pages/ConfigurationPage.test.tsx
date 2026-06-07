import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeStoreState } from "../state";
import { ConfigurationPage } from "./ConfigurationPage";

function state(overrides: Partial<RuntimeStoreState> = {}): RuntimeStoreState {
  return {
    generated_at: "2026-05-27T18:00:00Z",
    domains: {
      system: { active: true, booted: true, freshness: "fresh" },
      mission: { mission_state: "idle", latest: {}, freshness: "fresh" },
      operation: { status: "idle", latest: {}, freshness: "fresh" },
      configuration: {
        active_snapshot_id: "tracked/default.yaml",
        pending_edits: false,
        unsaved: false,
        non_default: false,
        freshness: "fresh",
        latest: {
          permissions: { writes_allowed: true, write_rejections: [] },
          manifest: {
            status: {
              pending_edits: false,
              unsaved: false,
              non_default: false,
              loaded_snapshot_id: "tracked/default.yaml",
              default_snapshot_id: "tracked/default.yaml",
              badges: [],
            },
            available_snapshots: [
              { snapshot_id: "tracked/default.yaml", label: "default", is_default: true, is_loaded: true },
              { snapshot_id: "snapshots/tuned.yaml", label: "tuned", is_default: false, is_loaded: false },
            ],
            nodes: [
              {
                node_id: "controller",
                label: "Controller",
                groups: [
                  {
                    group_id: "gains",
                    label: "Control gains",
                    node_id: "controller",
                    parameters: [
                      {
                        node_id: "controller",
                        group_id: "gains",
                        name: "/control/gains/p",
                        value_type: "float",
                        current_value: 1.2,
                        loaded_value: 1.2,
                        default_value: 1.0,
                        description: "P gain",
                        constraints: { minimum: 0, maximum: 10, step: 0.1 },
                        restart_required: "none",
                      },
                      {
                        node_id: "controller",
                        group_id: "gains",
                        name: "/control/static_frame",
                        value_type: "string",
                        current_value: "map",
                        loaded_value: "map",
                        default_value: "map",
                        description: "Frame id",
                        restart_required: "node",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    },
    events: [],
    command_results: [],
    connection: {
      connected: true,
      stale: false,
      reconnect_attempt: 0,
      next_reconnect_delay_ms: null,
      commands_disabled_reason: null,
    },
    ...overrides,
  };
}

function accepted(command_id = "configuration.apply") {
  return {
    request_id: `${command_id}-1`,
    command_id,
    accepted: true,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ConfigurationPage", () => {
  it("renders a structured manifest browser with search filtering and no raw text editor", () => {
    render(<ConfigurationPage state={state()} dispatchCommand={vi.fn()} />);

    expect(screen.getByText("Controller")).toBeInTheDocument();
    expect(screen.getByLabelText("/control/gains/p")).toHaveValue(1.2);
    expect(screen.getByLabelText("/control/static_frame")).toHaveValue("map");
    expect(document.querySelector("textarea")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "static" } });

    expect(screen.queryByLabelText("/control/gains/p")).not.toBeInTheDocument();
    expect(screen.getByLabelText("/control/static_frame")).toBeInTheDocument();
  });

  it("stages edits locally until per-parameter apply", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(accepted());
    render(<ConfigurationPage state={state()} dispatchCommand={dispatchCommand} />);
    const row = screen.getByText("/control/gains/p").closest("article");
    expect(row).not.toBeNull();

    fireEvent.change(within(row as HTMLElement).getByLabelText("/control/gains/p"), { target: { value: "2.5" } });

    expect(screen.getByText("1 frontend-only edit staged.")).toBeInTheDocument();
    expect(dispatchCommand).not.toHaveBeenCalled();

    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Apply" }));

    expect(dispatchCommand).toHaveBeenCalledWith("configuration.apply", {
      edits: [{ node_id: "controller", name: "/control/gains/p", value: 2.5 }],
    });
    expect(await screen.findByRole("status")).toHaveTextContent("1 parameter edit applied");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("validates staged edits and supports batch reset", () => {
    render(<ConfigurationPage state={state()} dispatchCommand={vi.fn()} />);
    const row = screen.getByText("/control/gains/p").closest("article");
    expect(row).not.toBeNull();

    fireEvent.change(within(row as HTMLElement).getByLabelText("/control/gains/p"), { target: { value: "-1" } });

    expect(screen.getByText("Value must be at least 0.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply all" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));

    expect(screen.getByText("0 frontend-only edits staged.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply all" })).toBeDisabled();
  });

  it("uses Pending edits, Unsaved, and Non-default badge precedence", () => {
    const manifestState = state();
    const manifest = manifestState.domains.configuration?.latest?.manifest as {
      status: { unsaved: boolean; non_default: boolean };
    };
    manifest.status.unsaved = true;
    manifest.status.non_default = true;

    render(<ConfigurationPage state={manifestState} dispatchCommand={vi.fn()} />);

    expect(screen.getAllByText("Unsaved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("yes").length).toBeGreaterThan(0);
  });

  it("saves new snapshots immediately and requires explicit overwrite confirmation", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(accepted("configuration.snapshot.save"));
    render(<ConfigurationPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.change(screen.getByLabelText("Snapshot label"), { target: { value: "operator" } });
    fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));

    expect(dispatchCommand).toHaveBeenCalledWith("configuration.snapshot.save", { label: "operator" });
    expect(await screen.findByRole("status")).toHaveTextContent("Snapshot operator saved");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Snapshot label"), { target: { value: "default" } });
    fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));

    expect(await screen.findByText("Overwrite existing snapshot tracked/default.yaml?")).toBeInTheDocument();
    expect(dispatchCommand).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Confirm overwrite" }));

    expect(dispatchCommand).toHaveBeenCalledWith("configuration.snapshot.save", {
      label: "default",
      overwrite_snapshot_id: "tracked/default.yaml",
    });
  });

  it("wires download immediately and load/default with press-and-hold", () => {
    vi.useFakeTimers();
    const dispatchCommand = vi.fn().mockResolvedValue(accepted("configuration.snapshot.load"));
    render(<ConfigurationPage state={state()} dispatchCommand={dispatchCommand} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Download" })[0]);
    expect(dispatchCommand).toHaveBeenCalledWith("configuration.snapshot.download", {
      snapshot_id: "tracked/default.yaml",
    });

    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Load" })[1]);
    act(() => vi.advanceTimersByTime(1500));
    fireEvent.pointerUp(screen.getAllByRole("button", { name: "Load" })[1]);

    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Set default" })[1]);
    act(() => vi.advanceTimersByTime(1500));
    fireEvent.pointerUp(screen.getAllByRole("button", { name: "Set default" })[1]);

    expect(dispatchCommand).toHaveBeenCalledWith("configuration.snapshot.load", { snapshot_id: "snapshots/tuned.yaml" });
    expect(dispatchCommand).toHaveBeenCalledWith("configuration.snapshot.set_default", { snapshot_id: "snapshots/tuned.yaml" });
    expect(screen.getByText("Setting a default while runtime is active affects the next load or restart.")).toBeInTheDocument();
  });

  it("disables writes in Mission mode while read-only download remains available", () => {
    const dispatchCommand = vi.fn().mockResolvedValue(accepted("configuration.snapshot.download"));
    render(
      <ConfigurationPage
        state={state({ domains: { mission: { mission_state: "active", latest: {}, freshness: "fresh" }, configuration: state().domains.configuration } })}
        dispatchCommand={dispatchCommand}
      />,
    );

    expect(screen.getAllByText("configuration writes are disabled in Mission mode").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save snapshot" })).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Download" })[0]);

    expect(dispatchCommand).toHaveBeenCalledWith("configuration.snapshot.download", {
      snapshot_id: "tracked/default.yaml",
    });
  });
});
