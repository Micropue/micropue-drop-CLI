import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DropConfigError } from "./errors.js";
import { promptHidden } from "./prompt.js";

function authFile() {
  if (process.env.DROP_AUTH_FILE) {
    return path.resolve(process.env.DROP_AUTH_FILE);
  }
  const configRoot =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configRoot, "micropue-drop", "auth.json");
}

export async function readStoredKey() {
  try {
    const raw = await readFile(authFile(), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.apiKey === "string" && parsed.apiKey.trim()
      ? parsed.apiKey.trim()
      : null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new DropConfigError(`Invalid auth file: ${authFile()}`, {
        hint: "Run `drop logout` and `drop login` again.",
      });
    }
    throw error;
  }
}

export async function saveStoredKey(apiKey) {
  const target = authFile();
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(target), 0o700).catch(() => {});
  await writeFile(
    target,
    `${JSON.stringify({ apiKey, savedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(target, 0o600).catch(() => {});
  return target;
}

export async function clearStoredKey() {
  await rm(authFile(), { force: true });
}

export function storedKeyPath() {
  return authFile();
}

export async function resolveApiKey({ allowPrompt = true } = {}) {
  const environmentKey = process.env.DROP_API_KEY?.trim();
  if (environmentKey) {
    return environmentKey;
  }

  const stored = await readStoredKey();
  if (stored) {
    return stored;
  }

  if (!allowPrompt) {
    throw new DropConfigError("DROP API key is required.", {
      hint: "Set DROP_API_KEY, or run `drop login` once.",
    });
  }

  if (!process.stdin.isTTY) {
    throw new DropConfigError("DROP API key is required in non-interactive mode.", {
      hint: "Set DROP_API_KEY before running the command.",
    });
  }

  const key = (await promptHidden("DROP API key")).trim();
  if (!key) {
    throw new DropConfigError("No API key was provided.");
  }
  return key;
}
