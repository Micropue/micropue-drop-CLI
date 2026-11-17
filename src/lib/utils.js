import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { LIMITS, SUPPORTED_EXTENSIONS } from "./constants.js";

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function snapshotHash(files, folders = []) {
  const manifest = [
    ...files.map((file) => `${file.path}\0${file.sha256}\n`),
    ...folders.map((folder) => `${folder}/\0\n`),
  ].join("");
  return sha256(manifest);
}

export function foldersFromFiles(files) {
  const folders = new Set();
  for (const file of files) {
    const segments = file.path.split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      folders.add(current);
    }
  }
  return [...folders].sort();
}

export function isSupportedPath(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath));
}

export function hasWrongCaseSupportedExtension(filePath) {
  const extension = path.extname(filePath);
  return (
    !SUPPORTED_EXTENSIONS.has(extension) &&
    SUPPORTED_EXTENSIONS.has(extension.toLowerCase())
  );
}

export function isHiddenRelativePath(relativePath) {
  return relativePath.split("/").some((segment) => segment.startsWith("."));
}

export function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function resolveInside(parent, relativePath) {
  const normalized = relativePath.split("/").join(path.sep);
  const resolved = path.resolve(parent, normalized);
  if (!isInside(parent, resolved) || resolved === parent) {
    throw new Error(`Unsafe relative path: ${relativePath}`);
  }
  return resolved;
}

export function validateRelativeFilePath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return "File path must be a non-empty string.";
  }
  if (filePath.length > LIMITS.pathLength) {
    return `File path exceeds ${LIMITS.pathLength} characters: ${filePath}`;
  }
  if (filePath.startsWith("/") || filePath.endsWith("/")) {
    return `File path must not start or end with a slash: ${filePath}`;
  }
  if (filePath.includes("\\")) {
    return `File path must use forward slashes: ${filePath}`;
  }
  const segments = filePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\0"),
    )
  ) {
    return `File path contains an invalid segment: ${filePath}`;
  }
  if (hasWrongCaseSupportedExtension(filePath)) {
    return `File extensions must be lowercase: ${filePath}`;
  }
  if (!isSupportedPath(filePath)) {
    return `Unsupported file extension: ${filePath}`;
  }
  return null;
}

export function normalizeSlug(input) {
  return String(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug);
}

export function deriveSlug(root) {
  const base = path.basename(root);
  const normalized = normalizeSlug(base);
  if (isValidSlug(normalized)) {
    return normalized;
  }
  return `site-${randomUUID().slice(0, 6)}`;
}

export function normalizeVisibility(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "private") {
    return "password";
  }
  if (normalized === "public" || normalized === "password") {
    return normalized;
  }
  return null;
}

export function parsePositiveInteger(value, name, { min = 1, max } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || (max && number > max)) {
    const suffix = max ? ` between ${min} and ${max}` : ` of at least ${min}`;
    throw new Error(`${name} must be an integer${suffix}.`);
  }
  return number;
}

export function sleep(milliseconds, signal) {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Aborted"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function humanTimestamp(value) {
  if (!value) {
    return "never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}
