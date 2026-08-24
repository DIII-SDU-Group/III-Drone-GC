import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AngleField,
  CommandEventEntry,
  CommandResultNotice,
  CriticalWarningBanner,
  DisabledControl,
  NumericField,
  PRESS_AND_HOLD_DURATION_MS,
  PressAndHoldButton,
  ToastRegion,
  UrgentActionButton,
} from "./interaction";

describe("interaction primitives", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("confirms press-and-hold commands only after 1.5 seconds and exposes progress", () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<PressAndHoldButton label="Arm" onConfirm={onConfirm} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Arm" }));
    act(() => {
      vi.advanceTimersByTime(PRESS_AND_HOLD_DURATION_MS - 1);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("progressbar", { name: "Arm hold progress" })).not.toHaveAttribute(
      "aria-valuenow",
      "100",
    );

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Arm" })).toHaveClass("critical-button--sent");
    expect(screen.getByRole("button", { name: "Arm" })).toHaveTextContent("Arm - command sent");
    expect(screen.getByRole("progressbar", { name: "Arm hold progress" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByRole("progressbar", { name: "Arm hold progress" })).toHaveAttribute(
      "aria-valuetext",
      "Command sent",
    );

    fireEvent.pointerUp(screen.getByRole("button", { name: "Arm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Arm" })).not.toHaveClass("critical-button--sent");
    expect(screen.getByRole("progressbar", { name: "Arm hold progress" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("shows a press-and-hold hint after a brief click", () => {
    vi.useFakeTimers();
    render(<PressAndHoldButton label="Takeoff" onConfirm={vi.fn()} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Takeoff" }));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.pointerUp(screen.getByRole("button", { name: "Takeoff" }));

    expect(screen.getByText("Press and hold for 1.5 seconds.")).toBeInTheDocument();
  });

  it("cancels without dispatch when released before the bar is full", () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<PressAndHoldButton label="Land" onConfirm={onConfirm} />);

    const button = screen.getByRole("button", { name: "Land" });
    fireEvent.pointerDown(button);
    act(() => {
      vi.advanceTimersByTime(PRESS_AND_HOLD_DURATION_MS - 1);
    });
    fireEvent.pointerUp(button);
    act(() => {
      vi.advanceTimersByTime(10);
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("progressbar", { name: "Land hold progress" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("displays disabled reasons and blocks disabled critical controls", () => {
    const onConfirm = vi.fn();
    render(
      <PressAndHoldButton
        label="Land"
        onConfirm={onConfirm}
        disabledReason="Vehicle state is unknown"
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Land" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Vehicle state is unknown")).toBeInTheDocument();
  });

  it("exposes disabled reasons on pointer and keyboard focus, then dismisses them", () => {
    render(<DisabledControl reason="Vehicle state is stale"><button type="button" disabled>Hold</button></DisabledControl>);
    const button = screen.getByRole("button", { name: "Hold" });
    const wrapper = button.parentElement as HTMLElement;
    const tooltip = screen.getByRole("tooltip", { name: "Vehicle state is stale" });

    expect(button).toHaveAccessibleDescription("Vehicle state is stale");
    expect(tooltip).not.toHaveClass("disabled-tooltip--visible");
    fireEvent.pointerEnter(wrapper);
    expect(tooltip).toHaveClass("disabled-tooltip--visible");
    fireEvent.pointerLeave(wrapper);
    expect(tooltip).not.toHaveClass("disabled-tooltip--visible");
    fireEvent.focus(wrapper);
    expect(tooltip).toHaveClass("disabled-tooltip--visible");
    fireEvent.keyDown(wrapper, { key: "Escape" });
    expect(tooltip).not.toHaveClass("disabled-tooltip--visible");
  });

  it("removes stale tooltip linkage when a control becomes enabled", () => {
    const { rerender } = render(<DisabledControl reason="Blocked"><button type="button" disabled>Start</button></DisabledControl>);
    expect(screen.getByRole("button", { name: "Start" })).toHaveAccessibleDescription("Blocked");

    rerender(<DisabledControl><button type="button">Start</button></DisabledControl>);
    expect(screen.getByRole("button", { name: "Start" })).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("runs urgent actions only after pointer down and up on the control", () => {
    const onAction = vi.fn();
    const onBlocked = vi.fn();
    render(<UrgentActionButton label="Hold" onAction={onAction} onBlocked={onBlocked} />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Hold" }), { key: "Enter" });
    expect(onAction).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledTimes(1);

    const button = screen.getByRole("button", { name: "Hold" });
    fireEvent.pointerUp(button);
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders command rejection inline and as an event entry", () => {
    const result = {
      id: "result-1",
      severity: "danger" as const,
      title: "Rejected",
      message: "Takeoff requires armed state",
      timestamp: "2026-05-27T18:00:00Z",
    };

    render(
      <>
        <CommandResultNotice result={result} />
        <CommandEventEntry result={result} />
      </>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Takeoff requires armed state");
    expect(screen.getByText("2026-05-27T18:00:00Z")).toBeInTheDocument();
  });

  it("keeps critical warnings visible until acknowledged or resolved", () => {
    const onAcknowledge = vi.fn();
    const { rerender } = render(
      <CriticalWarningBanner
        title="Runtime stale"
        message="Telemetry has not updated recently"
        onAcknowledge={onAcknowledge}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Runtime stale");
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);

    rerender(
      <CriticalWarningBanner
        title="Runtime stale"
        message="Telemetry has not updated recently"
        acknowledged
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("auto-dismisses informational toasts", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const toast = {
      id: "toast-1",
      severity: "info" as const,
      title: "Saved",
      message: "Parameters staged",
      autoDismissMs: 1200,
    };
    const { rerender } = render(
      <ToastRegion
        onDismiss={onDismiss}
        toasts={[toast]}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const updatedOnDismiss = vi.fn();
    rerender(<ToastRegion onDismiss={updatedOnDismiss} toasts={[toast]} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(updatedOnDismiss).toHaveBeenCalledWith("toast-1");
  });

  it("auto-dismisses toasts without an explicit timeout", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastRegion
        onDismiss={onDismiss}
        toasts={[
          {
            id: "toast-rejected",
            severity: "danger",
            title: "Command rejected",
            message: "vehicle state unknown",
          },
        ]}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(3599);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledWith("toast-rejected");
  });

  it("renders numeric units and constraints", () => {
    const onChange = vi.fn();
    render(
      <NumericField
        id="altitude"
        label="Altitude"
        value={8}
        unit="m"
        min={2}
        max={30}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("Altitude")).toHaveAttribute("min", "2");
    expect(screen.getByText("2 to 30 m")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Altitude"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it("passes angle inputs with explicit degree units", () => {
    const onChange = vi.fn();
    render(
      <AngleField
        id="yaw"
        label="Yaw"
        value={90}
        min={-180}
        max={180}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("deg")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Yaw"), { target: { value: "45" } });
    expect(onChange).toHaveBeenCalledWith({ value: 45, unit: "degrees" });
  });
});
