import { describe, expect, it } from "vitest";

import { initialRuntimeStoreState, type RuntimeStoreState } from ".";
import { customOperationUnavailableReason, profileSurfaceUnavailableReason, runtimeProfile } from "./capabilities";

function withCapabilities(capabilities?: NonNullable<RuntimeStoreState["domains"]["system"]>["capabilities"]): RuntimeStoreState {
  return { ...initialRuntimeStoreState, domains: { system: { capabilities } } };
}

const OPTI_TRACK = {
  profile: "opti_track",
  payload_available: false,
  perception_available: false,
  overviews_available: false,
  cable_intents_available: false,
  simulation_available: false,
  custom_operations: ["fly_to_position", "hover"],
};

describe("profile capabilities", () => {
  it("explains every surface a restricted profile lacks", () => {
    const state = withCapabilities(OPTI_TRACK);

    expect(profileSurfaceUnavailableReason(state, "payload")).toBe("Payload control is not available in the opti_track profile.");
    expect(profileSurfaceUnavailableReason(state, "perception")).toBe("Powerline perception is not available in the opti_track profile.");
    expect(profileSurfaceUnavailableReason(state, "overviews")).toBe("Overview capture is not available in the opti_track profile.");
    expect(profileSurfaceUnavailableReason(state, "cable_intents")).toBe("Cable intent control is not available in the opti_track profile.");
    expect(customOperationUnavailableReason(state, "hover")).toBeUndefined();
    expect(customOperationUnavailableReason(state, "cable_landing")).toBe(
      "Custom operation cable_landing is not available in the opti_track profile.",
    );
  });

  it("restricts nothing when the runtime advertises full or no capabilities", () => {
    for (const state of [
      withCapabilities(undefined),
      withCapabilities({ profile: "real", custom_operations: null }),
      initialRuntimeStoreState,
    ]) {
      expect(profileSurfaceUnavailableReason(state, "payload")).toBeUndefined();
      expect(profileSurfaceUnavailableReason(state, "cable_intents")).toBeUndefined();
      expect(customOperationUnavailableReason(state, "cable_landing")).toBeUndefined();
    }
  });

  it("boots and starts with the runtime API's own profile before supervision reports one", () => {
    const unbooted: RuntimeStoreState = {
      ...initialRuntimeStoreState,
      domains: { system: { capabilities: OPTI_TRACK, latest: {} }, simulation: { profile: "unknown" } },
    };

    expect(runtimeProfile(unbooted)).toBe("opti_track");
    expect(runtimeProfile({ ...initialRuntimeStoreState, domains: { system: { latest: { profile: "hil" } } } })).toBe("hil");
    expect(runtimeProfile({ ...initialRuntimeStoreState, domains: { simulation: { profile: "unknown" } } })).toBeUndefined();
  });
});
