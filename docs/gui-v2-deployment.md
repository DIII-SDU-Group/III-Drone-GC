# GUI v2 Deployment

This note defines where GUI v2 components run in sim/dev and real profiles. It
keeps the runtime host and the ground-control computer separated so the operator
computer does not need ROS, DDS, MAVSDK, or III runtime packages.

## Topology

Sim/dev profile:

- `iii-runtime-api` runs inside the devcontainer with the III daemon and the
  simulation ROS/PX4 runtime.
- The GC proxy and frontend may run on the same development computer.
- Runtime discovery uses `_iii-runtime-api._tcp.local` over mDNS when available;
  manual endpoint entry remains the fallback.

Real profile:

- `iii-runtime-api` runs on the onboard runtime host.
- The III daemon, ROS graph, DDS discovery, MAVSDK/PX4 command transport, logs,
  configuration server, and rosbag access stay local to the onboard host.
- The GC proxy runs on the ground-control computer.
- The frontend is served from the ground-control computer, either by the GC
  proxy stack or by a separate static server/container.
- The frontend talks only to the local GC proxy. The GC proxy talks over the
  operator network to the selected onboard `iii-runtime-api`.

The ground-control computer must not run a ROS-aware v2 backend and must not
need direct DDS or MAVSDK connectivity. If the onboard runtime disconnects, the
static frontend remains available, marks runtime state disconnected/stale, and
keeps operator commands disabled until a runtime API is selected and
authenticated again.

## Runtime Host Environment

Real deployments should set these on the onboard host, usually through the
systemd environment file for `iii-runtime-api`:

- `III_SYSTEM_PROFILE=real`
- `III_RUNTIME_API_PROFILE=real`
- `III_RUNTIME_API_REQUIRE_SECRETS=1`
- `III_RUNTIME_API_HOST=0.0.0.0`
- `III_RUNTIME_API_PORT=8765`
- `III_RUNTIME_API_MDNS_ENABLED=1`
- `III_RUNTIME_API_MDNS_INSTANCE=<operator-visible runtime name>`
- `III_RUNTIME_API_MDNS_HOST=<runtime host address or DNS name>` when automatic
  address selection is not correct.
- `III_RUNTIME_API_SYSTEM_ID=<drone or system id>`
- `III_RUNTIME_API_BROWSER_PASSWORD=<operator login password>`
- `III_RUNTIME_API_CLI_TOKEN=<remote CLI token>`
- `III_RUNTIME_API_HEARTBEAT_INTERVAL_SEC=2`
- `III_RUNTIME_API_SESSION_LEASE_TIMEOUT_SEC=8`
- `III_RUNTIME_API_PX4_MAVLINK_ENDPOINT=<MAVLink endpoint>`
- `III_RUNTIME_API_PX4_ENABLED=1`
- `III_RUNTIME_API_LOG_DIR=<runtime API log directory>`

The browser password and CLI token are secrets. Do not commit real values.

## Ground-Control Environment

The GC stack runs on the ground-control computer with these environment values:

- `III_GC_PROXY_HOST=0.0.0.0`
- `III_GC_PROXY_PORT=8780`
- `III_GC_PROXY_CORS_ORIGINS=<frontend origins>`
- `III_GC_PROXY_PUBLIC_URL=http://<gc-host>:8780`
- `III_GC_FRONTEND_PORT=5173` for the current compose-served frontend port.

Manual endpoint fallback should point at the runtime API base URL, for example
`http://<runtime-host>:8765`. Remote CLI workflows may also use
`III_RUNTIME_API_URL=http://<runtime-host>:8765` plus
`III_RUNTIME_API_CLI_TOKEN`.

Compose entrypoints:

- `docker-compose.dev.yml`: Vite frontend plus GC proxy for active frontend
  development.
- `docker-compose.prod.yml`: built static frontend plus GC proxy for production
  serving from the ground-control computer.
- `docker-compose.yml`: production-compatible default compose file.
- `scripts/workspace/gui_v2_up.sh`: local sim/dev convenience launcher that
  starts the production compose stack on `http://127.0.0.1:5174` with matching
  proxy URL and CORS settings.

The GC proxy uses host networking in these compose files so zeroconf discovery
can see `_iii-runtime-api._tcp.local` advertisements on the operator network.
The frontend container is still exposed through `III_GC_FRONTEND_PORT`.

## Network Ports

Runtime host:

- TCP `8765`: `iii-runtime-api` HTTP and WebSocket API for GC proxy and remote
  CLI clients.
- UDP `5353`: mDNS/zeroconf discovery for `_iii-runtime-api._tcp.local` when
  discovery is enabled and the operator network permits multicast.
- TCP `22`: optional SSH administration/deploy/file-transfer path. It is not
  part of GUI v2 runtime control.

Ground-control computer:

- TCP `8780`: GC proxy API exposed to the frontend/browser.
- TCP `5173`: compose file default frontend port.
- TCP `5174`: local sim/dev convenience launcher frontend port. Production
  compose may map a static server to a different external port, but it still
  runs on the ground-control computer.

ROS, DDS, MAVLink/MAVSDK, the III daemon Unix socket, and systemd access remain
local to the runtime host. They are not exposed to the ground-control computer
as GUI v2 integration points.

## Security Decision

Decision for the first GUI v2 deployment: trusted isolated operator network.
Use runtime API browser-password authentication and remote CLI token
authentication. TLS is deferred for the first field deployment. TLS is optional
for lab experiments only.

This matches the current configuration:

- Runtime API and GC proxy URLs use `http://` and `ws://` by default.
- `III_RUNTIME_API_REQUIRE_SECRETS=1` is required in real profile.
- The browser password and CLI token are the shared deployment credentials.
- The GC proxy is not an open proxy; it can proxy only to discovered or manually
  validated `iii-runtime-api` endpoints.
- The production frontend is served from the ground-control computer, not from
  the runtime host.

Required operator-network controls:

- Runtime API TCP `8765` is reachable only from the operator network or the
  ground-control computer.
- GC proxy TCP `8780` and frontend TCP `5173` are reachable only from operator
  workstations.
- mDNS UDP `5353` is limited to the operator network. If multicast is blocked,
  use manual endpoint entry instead of broadening network exposure.
- CORS origins are explicit for the deployed frontend origin; do not use a
  wildcard origin in real profile.
- Development defaults such as `dev-password` and `dev-cli-token` are replaced
  before real-profile use.

Deferred TLS risk:

- A host on the trusted operator network could observe or replay HTTP traffic if
  it is compromised.
- A host on the trusted operator network could attempt mDNS spoofing; the GC
  proxy still validates selected endpoints with `/identity`. This validation is not a cryptographic identity proof.
- Shared credentials do not provide per-operator attribution.

Future TLS work should add certificate provisioning, HTTPS/WSS runtime API
support, proxy trust configuration, and certificate identity checks for manual
and discovered endpoints before GUI v2 is exposed outside a trusted isolated
operator network.
