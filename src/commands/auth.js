import { DropClient } from "../lib/api.js";
import {
  clearStoredKey,
  resolveApiKey,
  saveStoredKey,
  storedKeyPath,
} from "../lib/auth.js";
import { DEFAULT_API_BASE } from "../lib/constants.js";
import { formatError } from "../lib/errors.js";
import { promptHidden } from "../lib/prompt.js";
import {
  printDropBanner,
  printInfo,
  printProgress,
  printSuccess,
} from "../lib/terminal.js";

function apiBase(options) {
  return (
    options.apiUrl ??
    process.env.DROP_API_BASE ??
    DEFAULT_API_BASE
  ).replace(/\/+$/g, "");
}

async function verify(apiKey, baseUrl) {
  const client = new DropClient({ apiKey, baseUrl });
  return client.getMe();
}

export async function loginCommand(options = {}) {
  printDropBanner();
  const key =
    process.env.DROP_API_KEY?.trim() ||
    (await promptHidden("DROP API key")).trim();
  if (!key) {
    throw new Error("No API key was provided.");
  }
  const baseUrl = apiBase(options);
  printProgress("Verifying API key");
  let me;
  try {
    me = await verify(key, baseUrl);
  } catch (error) {
    throw new Error(formatError(error), { cause: error });
  }
  const path = await saveStoredKey(key);
  printSuccess(
    `Logged in as ${me.account.nickname || me.account.username} (@${me.account.username})`,
  );
  printInfo(`scopes  ${me.key.scopes.join(", ")}`);
  printInfo(`stored  ${path}`);
}

export async function logoutCommand() {
  await clearStoredKey();
  printSuccess(`Removed saved API key from ${storedKeyPath()}`);
}

export async function whoamiCommand(options = {}) {
  printDropBanner();
  const key = await resolveApiKey();
  const me = await verify(key, apiBase(options));
  printSuccess(
    `${me.account.nickname || me.account.username} (@${me.account.username})`,
  );
  printInfo(`scopes  ${me.key.scopes.join(", ")}`);
  printInfo(
    `limits  ${me.limits.filesPerProject} files · ${me.limits.projectBytes} bytes`,
  );
}
