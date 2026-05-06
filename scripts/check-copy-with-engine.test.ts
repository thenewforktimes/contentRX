/**
 * Tests for the engine-check dogfood script. fetch is mocked so
 * tests don't actually hit the engine; the wire-shape contract
 * is what we care about here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateString,
  mapWithConcurrency,
  severityFromVerdict,
} from "./check-copy-with-engine";
import type { ExtractedString } from "./extract-customer-strings";

function makeString(
  text: string,
  overrides: Partial<ExtractedString> = {},
): ExtractedString {
  return {
    file: "src/app/page.tsx",
    line: 1,
    col: 1,
    text,
    kind: "jsx-text",
    context: "p",
    content_type_hint: "body_paragraph",
    moment_hint: null,
    ...overrides,
  };
}

describe("severityFromVerdict", () => {
  it("maps violation → error", () => {
    expect(severityFromVerdict("violation")).toBe("error");
  });
  it("maps review_recommended → warning", () => {
    expect(severityFromVerdict("review_recommended")).toBe("warning");
  });
  it("maps pass → info", () => {
    expect(severityFromVerdict("pass")).toBe("info");
  });
  it("maps engine error → info (not the writer's fault)", () => {
    expect(severityFromVerdict("error")).toBe("info");
  });
});

describe("evaluateString (wire shape)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts text, content_type, moment, audience, mode=check", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: { verdict: "pass", violations: [] },
          latency_ms: 123,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await evaluateString(
      makeString("Use 'team' instead of 'guys'", {
        content_type_hint: "body_paragraph",
        moment_hint: null,
      }),
      {
        endpoint: "https://example.test/api/evaluate",
        secret: "shh",
        audience: "product_ui",
        timeoutMs: 5000,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = call[0];
    const init = call[1];
    expect(url).toBe("https://example.test/api/evaluate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-internal-secret"]).toBe("shh");
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe("Use 'team' instead of 'guys'");
    expect(body.audience).toBe("product_ui");
    expect(body.mode).toBe("check");
    expect(body.content_type).toBe("body_paragraph");
    // moment_hint was null, so the request omits it (engine classifies)
    expect(body.moment).toBeUndefined();
  });

  it("omits content_type when hint is null", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: { verdict: "pass" },
          latency_ms: 50,
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await evaluateString(
      makeString("untyped string", { content_type_hint: null }),
      {
        endpoint: "https://example.test/api/evaluate",
        secret: "shh",
        audience: "product_ui",
        timeoutMs: 5000,
      },
    );
    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    const body = JSON.parse(init.body as string);
    expect(body.content_type).toBeUndefined();
  });

  it("throws when the engine returns non-2xx", async () => {
    globalThis.fetch = (async () =>
      new Response("upstream broken", { status: 503 })) as typeof globalThis.fetch;

    await expect(
      evaluateString(makeString("hi"), {
        endpoint: "https://example.test/api/evaluate",
        secret: "shh",
        audience: "product_ui",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/503/);
  });

  it("aborts long-running calls past timeout", async () => {
    globalThis.fetch = ((async (_url: unknown, init: RequestInit) => {
      // Honor the abort signal: throw when the test triggers it.
      return new Promise<Response>((_, reject) => {
        const signal = init.signal;
        signal?.addEventListener("abort", () => {
          reject(new Error("AbortError"));
        });
      });
    }) as unknown) as typeof globalThis.fetch;

    await expect(
      evaluateString(makeString("hi"), {
        endpoint: "https://example.test/api/evaluate",
        secret: "shh",
        audience: "product_ui",
        timeoutMs: 50,
      }),
    ).rejects.toThrow();
  });
});

describe("mapWithConcurrency", () => {
  it("processes all items", async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await mapWithConcurrency(items, 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("respects the concurrency cap", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(items, 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("returns empty for empty input", async () => {
    const out = await mapWithConcurrency([] as number[], 5, async (n) => n);
    expect(out).toEqual([]);
  });
});
