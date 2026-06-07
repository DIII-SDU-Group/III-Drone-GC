# GUI v2 Security Checklist

Chosen model for the first deployment: trusted isolated operator network,
runtime API browser password, and runtime API CLI token. TLS is deferred and the
runtime API/GC proxy ports are not public interfaces.

## Required Checks

- Real profile sets `III_RUNTIME_API_REQUIRE_SECRETS=1`.
- Real profile replaces `dev-password` and `dev-cli-token`.
- Runtime API TCP `8765` is reachable only from the operator network or the
  ground-control computer.
- GC proxy TCP `8780` and frontend TCP `5173` are reachable only from operator
  workstations.
- mDNS UDP `5353` is limited to the operator network, or manual endpoint entry
  is used when multicast is blocked.
- `III_GC_PROXY_CORS_ORIGINS` is set to the deployed frontend origin; wildcard
  CORS is not used in real profile.
- The GC proxy validates discovered/manual runtime endpoints with `/identity`
  before selection.
- `/identity` and `/health` are the only intended unauthenticated runtime API
  discovery surfaces.
- Runtime static frontend assets are served from the ground-control computer,
  not from the drone/runtime host.
- The deployment risk log accepts the deferred TLS risks before field use.

## Automated Verification

Run these package tests before field/lab acceptance:

```bash
source /opt/ros/jazzy/setup.bash
python3 -m pytest \
  src/III-Drone-Runtime/test/test_runtime_api_skeleton.py \
  src/III-Drone-Runtime/test/test_browser_session.py \
  src/III-Drone-Runtime/test/test_cli_auth_policy.py \
  src/III-Drone-Runtime/test/test_runtime_api_config.py \
  src/III-Drone-GC/test/test_v2_proxy_targets.py \
  src/III-Drone-GC/test/test_v2_proxy_forwarding.py \
  -q
```

Expected coverage:

- Runtime `/identity` and `/health` are the only unauthenticated discovery
  surfaces.
- Detailed runtime state, logs, events, command handlers, and browser command
  endpoints require a browser session token.
- Browser login creates one active session; a second fresh browser login is
  rejected until logout or lease expiry.
- CLI token auth is separate from the browser password.
- Remote CLI read-only commands are allowed during an active GUI session.
- Remote CLI mutating commands are rejected during an active GUI session and
  emit a runtime event.
- GC proxy refuses proxying before a runtime is selected.
- GC proxy validates endpoints through `/identity` before selection and rejects
  unknown endpoint IDs.
- GC proxy rejects absolute upstream paths under `/proxy/...`; the selected
  runtime base URL cannot be overridden by a caller-supplied URL.

## Deferred TLS Work

- Add HTTPS/WSS support for `iii-runtime-api`.
- Add HTTPS/WSS support or a terminating reverse proxy for the GC proxy.
- Define certificate provisioning and renewal for the onboard runtime host.
- Validate certificate identity for discovered and manually entered endpoints.
- Replace shared deployment credentials with per-operator identity if required
  by operations policy.
