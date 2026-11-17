import {
  DEFAULT_API_BASE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_REQUEST_TIMEOUT_MS,
  PACKAGE_NAME,
} from "./constants.js";
import { DropApiError } from "./errors.js";

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("DROP API URL must use http or https.");
  }
  return value.replace(/\/+$/g, "");
}

function timeoutFromEnvironment() {
  const raw = process.env.DROP_REQUEST_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  const number = Number(raw);
  if (
    !Number.isSafeInteger(number) ||
    number < 1_000 ||
    number > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new Error(
      `DROP_REQUEST_TIMEOUT_MS must be between 1000 and ${MAX_REQUEST_TIMEOUT_MS}.`,
    );
  }
  return number;
}

export class DropClient {
  constructor({
    apiKey,
    baseUrl = process.env.DROP_API_BASE || DEFAULT_API_BASE,
    timeoutMs = timeoutFromEnvironment(),
    fetchImpl = globalThis.fetch,
    userAgent = `${PACKAGE_NAME}`,
  } = {}) {
    if (!apiKey) {
      throw new Error("DropClient requires an API key.");
    }
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
  }

  async request(method, relativePath, { body, headers = {}, signal } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort(signal.reason);
    if (signal?.aborted) {
      clearTimeout(timer);
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    const url = `${this.baseUrl}${relativePath}`;
    const requestHeaders = {
      accept: "application/json, application/problem+json",
      authorization: `Bearer ${this.apiKey}`,
      "user-agent": this.userAgent,
      ...headers,
    };
    if (body !== undefined) {
      requestHeaders["content-type"] = "application/json";
    }

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const responseText = await response.text();
      let payload = null;
      if (responseText) {
        try {
          payload = JSON.parse(responseText);
        } catch {
          payload = null;
        }
      }

      if (!response.ok) {
        throw new DropApiError(
          payload?.detail ||
            payload?.title ||
            `DROP returned HTTP ${response.status}.`,
          {
            status: response.status,
            code: payload?.code,
            requestId: payload?.requestId,
            retryAfter: parseRetryAfter(response.headers.get("retry-after")),
            issues: Array.isArray(payload?.errors) ? payload.errors : [],
          },
        );
      }

      return payload;
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      if (timedOut) {
        throw new DropApiError(
          `DROP did not respond within ${this.timeoutMs} ms.`,
          { code: "request_timeout" },
        );
      }
      if (error instanceof DropApiError) {
        throw error;
      }
      throw new DropApiError(`Could not reach DROP: ${error.message}`, {
        code: "network_error",
        cause: error,
        hint: `Check your network and DROP_API_BASE (${this.baseUrl}).`,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  getMe(options) {
    return this.request("GET", "/me", options);
  }

  getProject(projectId, options) {
    return this.request(
      "GET",
      `/projects/${encodeURIComponent(projectId)}`,
      options,
    );
  }

  createProject(payload, { idempotencyKey, signal } = {}) {
    const headers = {};
    if (idempotencyKey) {
      headers["idempotency-key"] = idempotencyKey;
    }
    return this.request("POST", "/projects", {
      body: payload,
      headers,
      signal,
    });
  }

  updateProject(projectId, payload, { revision, idempotencyKey, signal } = {}) {
    const headers = {};
    if (revision) {
      headers["if-match"] = `"rev-${revision}"`;
    }
    if (idempotencyKey) {
      headers["idempotency-key"] = idempotencyKey;
    }
    return this.request(
      "PATCH",
      `/projects/${encodeURIComponent(projectId)}`,
      { body: payload, headers, signal },
    );
  }

  deployProject(projectId, payload, { revision, idempotencyKey, signal } = {}) {
    const headers = {};
    if (revision) {
      headers["if-match"] = `"rev-${revision}"`;
    }
    if (idempotencyKey) {
      headers["idempotency-key"] = idempotencyKey;
    }
    return this.request(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/deploy`,
      { body: payload, headers, signal },
    );
  }
}

export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return undefined;
  }
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }
  const date = Date.parse(normalized);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((date - now) / 1000));
}
