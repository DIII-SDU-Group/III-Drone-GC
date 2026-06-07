export type ProxyHealth = {
  proxy: string;
};

const DEFAULT_PROXY_URL = "http://localhost:8780";

export function configuredProxyUrl(): string {
  return (import.meta.env.VITE_GC_PROXY_URL ?? DEFAULT_PROXY_URL).replace(/\/+$/, "");
}

export async function fetchProxyHealth(proxyUrl = configuredProxyUrl()): Promise<ProxyHealth> {
  const response = await fetch(`${proxyUrl}/health`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`GC proxy health check failed with HTTP ${response.status}`);
  }
  return (await response.json()) as ProxyHealth;
}
