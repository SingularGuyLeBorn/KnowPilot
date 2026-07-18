import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTunnelUrl } from "./remote.mjs";

test("extractTunnelUrl parses trycloudflare.com from cloudflared log", () => {
  const sample =
    "2026-07-18T10:00:00Z INF |  https://abc-def-123.trycloudflare.com\n";
  assert.equal(extractTunnelUrl(sample), "https://abc-def-123.trycloudflare.com");
});

test("extractTunnelUrl returns null when absent", () => {
  assert.equal(extractTunnelUrl("INF Registered tunnel connection"), null);
});
