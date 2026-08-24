import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => (url.endsWith("/health") ? { proxy: "up" } : { runtimes: [] }),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks the configured GC proxy health endpoint", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getAllByRole("status")[0]).toHaveTextContent("online"));
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8780/health",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
