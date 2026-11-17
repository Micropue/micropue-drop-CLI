import assert from "node:assert/strict";
import test from "node:test";

import { DropClient, parseRetryAfter } from "../src/lib/api.js";
import { DropApiError } from "../src/lib/errors.js";
import { jsonResponse } from "./helpers.js";

const TEST_API_KEY = ["fixture", "key"].join("-");

test("DropClient sends authentication and JSON request headers", async () => {
  let received;
  const client = new DropClient({
    apiKey: TEST_API_KEY,
    baseUrl: "https://example.test/v1/",
    fetchImpl: async (url, options) => {
      received = { url, options };
      return jsonResponse({ account: { username: "micropue" } });
    },
  });

  const payload = await client.createProject(
    { name: "Example" },
    { idempotencyKey: "idem-1" },
  );

  assert.equal(payload.account.username, "micropue");
  assert.equal(received.url, "https://example.test/v1/projects");
  assert.equal(received.options.method, "POST");
  assert.equal(
    received.options.headers.authorization,
    `Bearer ${TEST_API_KEY}`,
  );
  assert.equal(received.options.headers.accept, "application/json, application/problem+json");
  assert.equal(received.options.headers["content-type"], "application/json");
  assert.equal(received.options.headers["idempotency-key"], "idem-1");
  assert.equal(received.options.body, JSON.stringify({ name: "Example" }));
});

test("DropClient sends revision preconditions for deploy and metadata updates", async () => {
  const calls = [];
  const client = new DropClient({
    apiKey: TEST_API_KEY,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true });
    },
  });

  await client.deployProject(
    "project/one",
    { files: [] },
    { revision: 3, idempotencyKey: "deploy-1" },
  );
  await client.updateProject(
    "project/one",
    { name: "New name" },
    { revision: 4, idempotencyKey: "update-1" },
  );

  assert.equal(calls[0].url.endsWith("/projects/project%2Fone/deploy"), true);
  assert.equal(calls[0].options.headers["if-match"], '"rev-3"');
  assert.equal(calls[0].options.headers["idempotency-key"], "deploy-1");
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[1].options.headers["if-match"], '"rev-4"');
  assert.equal(calls[1].options.headers["idempotency-key"], "update-1");
});

test("DropClient exposes problem details and Retry-After", async () => {
  const client = new DropClient({
    apiKey: TEST_API_KEY,
    fetchImpl: async () =>
      jsonResponse(
        {
          title: "Too many requests",
          detail: "Slow down.",
          code: "rate_limited",
          requestId: "request-123",
          errors: [{ path: "files", message: "Retry later." }],
        },
        {
          status: 429,
          headers: { "retry-after": "7" },
        },
      ),
  });

  await assert.rejects(
    client.getProject("project-1"),
    (error) => {
      assert.ok(error instanceof DropApiError);
      assert.equal(error.message, "Slow down.");
      assert.equal(error.status, 429);
      assert.equal(error.code, "rate_limited");
      assert.equal(error.requestId, "request-123");
      assert.equal(error.retryAfter, 7);
      assert.deepEqual(error.issues, [
        { path: "files", message: "Retry later." },
      ]);
      return true;
    },
  );
});

test("Retry-After parsing supports seconds, HTTP dates and absence", () => {
  const now = Date.parse("2026-11-17T00:00:00.000Z");
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter(""), undefined);
  assert.equal(parseRetryAfter("garbage"), undefined);
  assert.equal(parseRetryAfter("12", now), 12);
  assert.equal(
    parseRetryAfter("Tue, 17 Nov 2026 00:00:09 GMT", now),
    9,
  );
  assert.equal(
    parseRetryAfter("Tue, 17 Nov 2026 00:00:00 GMT", now),
    0,
  );
});

test("an absent Retry-After header is not interpreted as zero", async () => {
  const client = new DropClient({
    apiKey: TEST_API_KEY,
    fetchImpl: async () =>
      jsonResponse(
        { detail: "Service unavailable.", code: "unavailable" },
        { status: 503 },
      ),
  });

  await assert.rejects(
    client.getMe(),
    (error) => error instanceof DropApiError && error.retryAfter === undefined,
  );
});

test("DropClient times out while reading a stalled response body", async () => {
  const client = new DropClient({
    apiKey: TEST_API_KEY,
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    }),
  });

  await assert.rejects(
    client.getMe(),
    (error) =>
      error instanceof DropApiError &&
      error.code === "request_timeout",
  );
});

test("DropClient propagates an external abort", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Stopped", "AbortError"));
  const client = new DropClient({
    apiKey: "fixture-key",
    fetchImpl: async () => jsonResponse({}),
  });

  await assert.rejects(
    client.getMe({ signal: controller.signal }),
    (error) => error.name === "AbortError",
  );
});

test("DropClient rejects invalid API base URLs", () => {
  assert.throws(
    () =>
      new DropClient({
        apiKey: TEST_API_KEY,
        baseUrl: "file:///tmp/api",
      }),
    /http or https/,
  );
});
