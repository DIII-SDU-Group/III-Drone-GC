import { buildProxyWebSocketUrl } from "./gcProxy";

export type LogSourceSummary = {
  source_id: string;
  label: string;
  kind: string;
  path?: string | null;
};

export type LogLine = {
  source_id: string;
  source_label: string;
  kind: string;
  line: string;
};

export type LogFollowHandle = {
  close(): void;
};

export type RuntimeLogsClient = {
  listSources(): Promise<LogSourceSummary[]>;
  tail(sourceId: string, lines: number): Promise<LogLine[]>;
  download(sourceId: string): Promise<string>;
  follow(sourceId: string, onLine: (line: LogLine) => void, onError: (message: string) => void, onState?: (connected: boolean) => void): LogFollowHandle;
};

export function createRuntimeLogsClient(
  proxyUrl: string,
  tokenProvider: () => string | null,
  createWebSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
): RuntimeLogsClient {
  const baseUrl = proxyUrl.replace(/\/+$/, "");
  return {
    listSources: async () => {
      const payload = await requestJson<{ sources: LogSourceSummary[] }>(baseUrl, tokenProvider, "/proxy/logs/sources");
      return payload.sources;
    },
    tail: async (sourceId, lines) => {
      const payload = await requestJson<{ lines: LogLine[] }>(
        baseUrl,
        tokenProvider,
        `/proxy/logs/${encodeURIComponent(sourceId)}/tail?lines=${lines}`,
      );
      return payload.lines;
    },
    download: async (sourceId) => {
      const payload = await requestJson<{ content: string }>(
        baseUrl,
        tokenProvider,
        `/proxy/logs/${encodeURIComponent(sourceId)}/download`,
      );
      return payload.content;
    },
    follow: (sourceId, onLine, onError, onState) => {
      const token = tokenProvider();
      if (!token) {
        onError("Log follow requires an authenticated runtime session.");
        onState?.(false);
        return { close: () => undefined };
      }
      const socket = createWebSocket(buildProxyWebSocketUrl(baseUrl, `logs/follow/${encodeURIComponent(sourceId)}`, token));
      socket.onopen = () => onState?.(true);
      socket.onmessage = (event) => {
        try {
          onLine(JSON.parse(String(event.data)) as LogLine);
        } catch {
          onError("Received malformed log line from runtime API.");
        }
      };
      socket.onerror = () => {
        onState?.(false);
        onError("Log follow WebSocket failed.");
      };
      socket.onclose = () => onState?.(false);
      return { close: () => socket.close() };
    },
  };
}

async function requestJson<T>(
  baseUrl: string,
  tokenProvider: () => string | null,
  path: string,
): Promise<T> {
  const token = tokenProvider();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(response.statusText || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}
