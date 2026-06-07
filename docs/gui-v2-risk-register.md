# GUI v2 Risk Register

This register is the completion gate for the open risks and dependencies from
`gui-v2-spec.md`. GUI v2 is complete only when every risk below is classified
as implemented, automated, manual acceptance, or accepted/deferred with an
explicit owner and verification path.

## Classification Rules

- `Implemented`: feature or control exists in the codebase and is covered by
  targeted tests or a broader suite.
- `Automated`: risk is primarily closed by a repeatable automated test or
  script.
- `Manual acceptance`: risk depends on real hardware, network, or field setup
  and must be signed off with the real-profile checklist.
- `Accepted/deferred`: risk is intentionally not solved in GUI v2 and has a
  documented operational constraint or follow-up gate.

No risk may be left without one of these classifications at final acceptance.

## Register

| Risk | Owner task(s) | Classification | Evidence | Final gate |
| --- | --- | --- | --- | --- |
| submodule split and lock governance | P0.T0, P0.T1, P11.T0, P12.T0 | Implemented, automated | Workspace submodules include Contracts and Runtime; dependency governance remains through `deps/submodule-lock.txt`, `scripts/git/update_submodule_lock.sh`, and `scripts/git/verify_submodule_lock.sh`; full suite script verifies contract/type freshness. | Submodule lock update and verify pass in the final workspace validation. |
| runtime API bootstrap/systemd permissions | P2.T0, P2.T1, P3.T0, P10.T0, P10.T2, P11.T3 | Implemented, manual acceptance | Runtime API is a separate service from `iii-system-daemon`, exposes daemon/socket/booted/active state, and real-profile acceptance checks runtime service reachability and mutating-command rejection under unsafe state. | Run automated runtime API tests and complete the real-profile acceptance rows for runtime status and dangerous runtime mutations before field use. |
| remote CLI migration away from SSH command forwarding | P3.T0, P3.T1, P10.T4, P11.T0, P11.T5 | Implemented, automated | `tools/III-Drone-CLI` uses runtime API client paths for remote runtime control and logs; SSH remains for deployment/admin only; CLI tests run in the full suite. | Full suite CLI tests pass and operator docs do not instruct remote command forwarding over SSH. |
| mDNS blocking and manual endpoint fallback | P8.T0, P8.T1, P10.T5, P11.T3 | Implemented, manual acceptance | GC proxy discovery validates `/identity`; manual endpoint add/validate/select paths are implemented; deployment/security docs define manual fallback when UDP 5353 is blocked. | Real-profile acceptance records both mDNS discovery or documented multicast block plus manual endpoint validation. |
| browser password/CLI token security and TLS/trusted-network decision | P2.T2, P2.T3, P8.T4, P10.T5, P11.T4 | Automated, accepted/deferred | Browser session auth, heartbeat/lease, CLI token auth, endpoint validation, CORS, and open-proxy protections have targeted tests; TLS is explicitly deferred in `gui-v2-security-checklist.md` under trusted isolated operator network assumptions. | Security test set passes; real deployments set non-dev secrets and accept the deferred TLS risk before field use. |
| PX4 MAVLink/MAVSDK availability over FCU Ethernet | P5.T0, P5.T1, P9.T8, P11.T3 | Implemented, manual acceptance | Runtime vehicle state contracts expose command transport availability, endpoint, heartbeat, and update timestamps; Flight page and real-profile checklist require FCU Ethernet/MAVLink evidence. | Real-profile acceptance captures `/vehicle/status` and Flight page evidence with connected MAVSDK/MAVLink transport before real flight workflows. |
| fused PX4/ROS fail-closed state | P5.T1, P5.T2, P6.T0, P9.T3, P9.T8, P11.T3 | Implemented, automated, manual acceptance | Vehicle/control command gates use fused state freshness/source availability and reject unsafe, stale, unknown, or conflicting state; automated runtime command tests cover rejection paths and real-profile checklist covers ROS/uXRCE disagreement. | Automated command-gating tests pass and field/lab evidence shows dangerous commands fail closed during stale or conflicting vehicle state. |
| required typed ROS health/status topics | P4.T0, P4.T1, P4.T2, P6.T0, P11.T0 | Implemented, automated | Runtime API aggregates typed health/status domains without log scraping; system, vehicle, mission, operations, payload, perception, and configuration contract tests are included in the suite. | Full test suite passes with runtime API domain tests and no GUI v2 code depending on raw ROS messages. |
| configuration manifest/snapshot semantics | P6.T2, P9.T6, P11.T0, P11.T3 | Implemented, automated, manual acceptance | Configuration contracts and runtime handlers expose manifest, load, save, apply, diff, and snapshot semantics; tests cover the configuration stack; real-profile checklist verifies writes are gated by owner/mode state. | Configuration stack tests pass and real-profile evidence records representative blocked/allowed configuration workflow behavior. |
| rosbag recorder ownership/reconciliation/export | P6.T3, P9.T7, P11.T0, P11.T3 | Implemented, automated, manual acceptance | Runtime API owns recorder state, list/export/delete command paths, and frontend Rosbags page; full suite includes runtime/frontend coverage; real-profile checklist confirms access stays runtime-host-local. | Automated runtime/frontend tests pass and field/lab evidence shows rosbag access only through runtime API/proxy endpoints. |
| map/perception geometry shaping and stale-source behavior | P7.T0, P7.T1, P9.T9, P11.T0, P11.T2 | Implemented, automated | Runtime API transforms TF/perception/powerline state into compact map contracts; frontend uses generated types; sim smoke captures Map page/API health and stale/disconnected behavior through runtime/proxy paths. | Full suite and sim E2E smoke pass with map/perception endpoints available through the proxy. |
| all-logs/ROS-node log source model | P3.T2, P3.T3, P9.T10, P11.T0, P11.T3 | Implemented, automated, manual acceptance | Runtime API exposes log sources, REST tail, and WebSocket follow for daemon/API/ROS-node-oriented logs; frontend Logs page and CLI log paths use the API; real-profile checklist records log access through proxy only. | Full suite log tests pass and real-profile evidence includes Logs page plus runtime/proxy log-source JSON. |
| full-scope implementation size and incremental testability | P11.T0, P11.T1, P11.T2, P11.T3, P11.T4, P12.T0 | Automated | `scripts/workspace/run_iii_test_suite.sh` is the integration gate, parity and risk docs are tested, sim smoke is repeatable, and the coverage matrix maps every spec section to owner tasks/evidence/deferred work. | Final acceptance runs the full suite, sim smoke where runtime is available, submodule lock verify, and this register's doc test. |

## Final Review Checklist

- [x] `python3 -m pytest src/III-Drone-GC/test/test_gui_v2_risk_register_doc.py -q`
  passes.
- [x] `./scripts/workspace/run_iii_test_suite.sh` passes in the devcontainer.
- [x] `scripts/workspace/gui_v2_sim_e2e_smoke.py --start-compose` passes when a
  sim runtime API is available.
- [x] `./scripts/git/update_submodule_lock.sh && ./scripts/git/verify_submodule_lock.sh`
  passes after intentional submodule changes.

Pre-field gates:

- Complete real-profile acceptance before field use for risks classified as
  `Manual acceptance`.
- Accept deferred TLS/trusted-network constraints before real-profile
  operation.

## Final Review Result

All risks from the GUI v2 spec are classified in this register. No open risk remains without an owner, evidence source, and final gate.
