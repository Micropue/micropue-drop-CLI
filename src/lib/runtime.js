import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_API_BASE,
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
} from "./constants.js";
import { DropConfigError } from "./errors.js";
import {
  deriveSlug,
  isValidSlug,
  normalizeSlug,
  normalizeVisibility,
  parsePositiveInteger,
} from "./utils.js";

const packageJsonPath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);

export async function packageVersion() {
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  );
  return packageJson.version;
}

export async function resolveDirectory(input = ".") {
  const root = path.resolve(process.cwd(), input || ".");
  let info;
  try {
    info = await stat(root);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new DropConfigError(`Directory does not exist: ${root}`);
    }
    throw error;
  }
  if (!info.isDirectory()) {
    throw new DropConfigError(`Not a directory: ${root}`);
  }
  return root;
}

export function resolveSettings(root, options = {}, config = null) {
  const requestedVisibility =
    options.private === true
      ? "password"
      : options.visibility ?? config?.visibility ?? "public";

  if (
    options.visibility &&
    normalizeVisibility(options.visibility) === null
  ) {
    throw new DropConfigError(
      `Unknown visibility: ${options.visibility}. Use public or password (or private).`,
    );
  }

  const visibility = normalizeVisibility(requestedVisibility);
  if (!visibility) {
    throw new DropConfigError(`Invalid visibility: ${requestedVisibility}`);
  }

  const rawSlug = options.slug ?? config?.slug ?? deriveSlug(root);
  const slug = normalizeSlug(rawSlug);
  if (!isValidSlug(slug)) {
    throw new DropConfigError(`Invalid slug: ${rawSlug}`, {
      hint: "Slugs must be 1-40 lowercase letters, numbers or hyphens.",
    });
  }

  const name = String(options.name ?? config?.name ?? path.basename(root)).trim();
  if (!name || name.length > 80) {
    throw new DropConfigError("Project name must contain 1-80 characters.");
  }

  const apiBase =
    options.apiUrl ??
    process.env.DROP_API_BASE ??
    config?.apiBase ??
    DEFAULT_API_BASE;
  try {
    const parsed = new URL(apiBase);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error();
    }
  } catch {
    throw new DropConfigError(`Invalid DROP API URL: ${apiBase}`);
  }

  const intervalMs = parsePositiveInteger(
    options.interval ?? DEFAULT_INTERVAL_MS,
    "--interval",
    { min: MIN_INTERVAL_MS },
  );

  const message =
    options.message === undefined ? undefined : String(options.message).trim();
  if (message !== undefined && message.length > 200) {
    throw new DropConfigError("--message must not exceed 200 characters.");
  }

  return {
    slug,
    name,
    visibility,
    apiBase: apiBase.replace(/\/+$/g, ""),
    intervalMs,
    password: options.password,
    explicitPassword: options.password !== undefined,
    message,
    force: options.force === true,
    poll: options.poll === true,
  };
}

export function metadataChanged(config, settings) {
  if (!config?.projectId) {
    return false;
  }
  return (
    config.slug !== settings.slug ||
    config.name !== settings.name ||
    config.visibility !== settings.visibility ||
    (settings.explicitPassword && settings.visibility === "password")
  );
}
