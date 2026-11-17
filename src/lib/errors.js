export class DropError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "DropError";
    this.code = options.code;
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
  }
}

export class DropApiError extends DropError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "DropApiError";
    this.status = options.status;
    this.requestId = options.requestId;
    this.retryAfter = options.retryAfter;
    this.issues = options.issues ?? [];
  }
}

export class DropConfigError extends DropError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "DropConfigError";
  }
}

export function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR" ||
    error?.cause?.name === "AbortError"
  );
}

export function formatError(error) {
  if (error instanceof DropApiError) {
    const status = error.status ? ` (HTTP ${error.status})` : "";
    const code = error.code ? ` [${error.code}]` : "";
    const lines = [`${error.message}${status}${code}`];
    if (error.requestId) {
      lines.push(`requestId: ${error.requestId}`);
    }
    for (const issue of error.issues) {
      lines.push(`- ${issue.path ? `${issue.path}: ` : ""}${issue.message}`);
    }
    if (error.hint) {
      lines.push(error.hint);
    }
    return lines.join("\n");
  }

  if (error instanceof DropError) {
    return error.hint ? `${error.message}\n${error.hint}` : error.message;
  }

  return error?.message || String(error);
}
