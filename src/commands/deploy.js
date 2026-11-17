import { DropClient } from "../lib/api.js";
import { resolveApiKey } from "../lib/auth.js";
import { readConfig } from "../lib/config.js";
import { publishSnapshot } from "../lib/deployer.js";
import { formatError } from "../lib/errors.js";
import { loadSnapshot } from "../lib/snapshot.js";
import {
  printDropBanner,
  printInfo,
  printProgress,
  printSuccess,
  printUrl,
} from "../lib/terminal.js";
import {
  metadataChanged,
  resolveDirectory,
  resolveSettings,
} from "../lib/runtime.js";

export async function deployCommand(directory, options = {}) {
  const root = await resolveDirectory(directory);
  const config = await readConfig(root);
  const settings = resolveSettings(root, options, config);
  const snapshot = await loadSnapshot(root, { allowBundleFallback: true });
  const needsWork =
    settings.force ||
    !config?.projectId ||
    config.contentHash !== snapshot.hash ||
    metadataChanged(config, settings);

  printDropBanner();
  printInfo(`site    ${root}`);
  printInfo(`project ${settings.slug} · ${settings.visibility}`);

  if (!needsWork) {
    printSuccess(`Already up to date · v${config.version}`);
    if (config.url) {
      printUrl(config.url);
    }
    return;
  }

  if (
    settings.visibility === "password" &&
    (!config?.projectId ||
      config.visibility !== "password" ||
      settings.explicitPassword) &&
    !settings.password &&
    !process.env.DROP_PASSWORD?.trim()
  ) {
    if (!process.stdin.isTTY) {
      throw new Error(
        "This site is password-protected but no password is available. Set DROP_PASSWORD.",
      );
    }
    const { promptHidden } = await import("../lib/prompt.js");
    settings.password = (await promptHidden("Site password")).trim();
  }

  const apiKey = await resolveApiKey();
  const client = new DropClient({ apiKey, baseUrl: settings.apiBase });
  let result;
  try {
    result = await publishSnapshot({
      root,
      config,
      settings,
      snapshot,
      client,
      onProgress: printProgress,
    });
  } catch (error) {
    throw new Error(formatError(error), { cause: error });
  }
  if (result.changed || result.metadataChanged) {
    printUrl(result.config.url);
    printInfo(
      `v${result.config.version} · revision ${result.config.revision} · ${result.config.files.length} files`,
    );
  }
}
