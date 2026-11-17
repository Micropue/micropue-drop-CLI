import path from "node:path";

import chokidar from "chokidar";

import { DropClient } from "../lib/api.js";
import { resolveApiKey } from "../lib/auth.js";
import { readConfig, syncDropBundle } from "../lib/config.js";
import { publishSnapshot } from "../lib/deployer.js";
import {
  DropConfigError,
  formatError,
  isAbortError,
} from "../lib/errors.js";
import { loadIgnoreMatcher } from "../lib/ignore.js";
import {
  loadWatchSnapshot,
} from "../lib/snapshot.js";
import {
  color,
  printDropBanner,
  printError,
  printInfo,
  printProgress,
  printSuccess,
  printUrl,
  printWarning,
} from "../lib/terminal.js";
import {
  formatBytes,
  hasWrongCaseSupportedExtension,
  toPosixPath,
} from "../lib/utils.js";
import {
  metadataChanged,
  resolveDirectory,
  resolveSettings,
} from "../lib/runtime.js";

function isRelevantWatchEvent(event, relativePath) {
  if (!relativePath) {
    return false;
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.startsWith("."))) {
    return false;
  }
  if (segments.some((segment) => segment === "node_modules" || segment === ".git")) {
    return false;
  }
  if (event === "addDir" || event === "unlinkDir") {
    return true;
  }
  return (
    [".html", ".css", ".js"].includes(path.extname(relativePath)) ||
    hasWrongCaseSupportedExtension(relativePath)
  );
}

function retryDelay(error, intervalMs) {
  if (error?.retryAfter && Number.isFinite(error.retryAfter)) {
    return Math.max(intervalMs, error.retryAfter * 1000);
  }
  return Math.max(intervalMs * 3, 5_000);
}

export async function watchCommand(directory, options = {}) {
  const root = await resolveDirectory(directory);
  let config = await readConfig(root);
  const settings = resolveSettings(root, options, config);
  const intervalMs = settings.intervalMs;
  const controller = new AbortController();
  let stopping = false;
  let watcher;
  let timer;
  let safetyTimer;
  let running = null;
  let pending = false;
  let pendingDelay = intervalMs;
  let ignoreMatcher;
  let apiKey;
  let client;
  let lastErrorSignature = null;
  let failedHash = null;
  let retryAfterAt = 0;
  let printedWarnings = false;

  let resolveStopped;
  const stopped = new Promise((resolve) => {
    resolveStopped = resolve;
  });

  const stop = () => {
    if (stopping) {
      return;
    }
    stopping = true;
    pending = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (safetyTimer) {
      clearInterval(safetyTimer);
      safetyTimer = null;
    }
    controller.abort();
    void watcher?.close();
    resolveStopped();
  };

  const onSignal = () => stop();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const ensureClient = async () => {
    if (!client) {
      apiKey ??= await resolveApiKey();
      client = new DropClient({
        apiKey,
        baseUrl: settings.apiBase,
      });
    }
    return client;
  };

  const getPasswordIfNeeded = async () => {
    if (settings.visibility !== "password") {
      return;
    }
    const needsPassword =
      !config?.projectId ||
      config.visibility !== "password" ||
      settings.explicitPassword;
    if (!needsPassword || settings.password) {
      return;
    }
    if (process.env.DROP_PASSWORD?.trim()) {
      return;
    }
    if (!process.stdin.isTTY) {
      throw new DropConfigError(
        "This site is password-protected but no password is available.",
        { hint: "Set DROP_PASSWORD or pass --password." },
      );
    }
    const { promptHidden } = await import("../lib/prompt.js");
    settings.password = (await promptHidden("Site password")).trim();
  };

  const armTimer = (delay) => {
    if (stopping) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void runCycle(false);
    }, delay);
  };

  const schedule = (delay = intervalMs) => {
    if (stopping) {
      return;
    }
    pending = true;
    if (running) {
      return;
    }
    pendingDelay = delay;
    armTimer(delay);
  };

  const runCycle = async (initial) => {
    if (stopping) {
      return;
    }
    if (running) {
      pending = true;
      return;
    }

    pending = false;
    running = (async () => {
      try {
        if (!ignoreMatcher) {
          ignoreMatcher = await loadIgnoreMatcher(root);
        }
        const snapshot = await loadWatchSnapshot(root, { initial });
        const wantsMetadata = metadataChanged(config, settings);
        const forceThisCycle = initial && settings.force;
        const needsWork =
          forceThisCycle ||
          !config?.projectId ||
          config.contentHash !== snapshot.hash ||
          wantsMetadata;

        if (!needsWork) {
          await syncDropBundle(root, snapshot, config);
          if (initial) {
            printSuccess(`Already up to date · v${config.version}`);
            if (config.url) {
              printUrl(config.url);
            }
          }
          return;
        }

        if (snapshot.hash === failedHash && Date.now() < retryAfterAt) {
          pending = true;
          pendingDelay = retryAfterAt - Date.now();
          return;
        }

        await getPasswordIfNeeded();
        const dropClient = await ensureClient();
        const nextVersion = config?.projectId
          ? Math.max((config.version ?? 0) + 1, 1)
          : 1;
        printProgress(
          `Publishing v${nextVersion} · ${snapshot.files.length} files · ${formatBytes(snapshot.totalBytes)}`,
        );
        const result = await publishSnapshot({
          root,
          config,
          settings: { ...settings, force: forceThisCycle },
          snapshot,
          client: dropClient,
          signal: controller.signal,
          onProgress: printProgress,
        });
        config = result.config;
        if (settings.explicitPassword) {
          settings.explicitPassword = false;
        }
        settings.password = undefined;
        failedHash = null;
        lastErrorSignature = null;
        if (result.changed || result.metadataChanged) {
          printUrl(config.url);
          printInfo(
            `v${config.version} · revision ${config.revision} · ${config.files.length} files`,
          );
        }
        if (initial && snapshot.warnings.length > 0 && !printedWarnings) {
          for (const warning of snapshot.warnings) {
            printWarning(warning);
          }
          printedWarnings = true;
        }
      } catch (error) {
        if (stopping || isAbortError(error)) {
          return;
        }
        const message = formatError(error);
        if (message !== lastErrorSignature) {
          printError(message);
          lastErrorSignature = message;
        }
        if (initial) {
          throw error;
        }
        try {
          const snapshot = await loadWatchSnapshot(root, { initial: false });
          failedHash = snapshot.hash;
        } catch {
          // Leave the failed hash empty; a later scan may recover.
        }
        retryAfterAt = Date.now() + retryDelay(error, intervalMs);
        pending = true;
        pendingDelay = retryDelay(error, intervalMs);
      }
    })();

    try {
      await running;
    } finally {
      running = null;
      if (pending && !stopping) {
        pending = false;
        const delay = pendingDelay;
        pendingDelay = intervalMs;
        armTimer(delay);
      }
    }
  };

  printDropBanner();
  printInfo(`watch   ${root}`);
  printInfo(`project ${color.bold(settings.slug)} · ${settings.visibility}`);
  printInfo(`interval ${(intervalMs / 1000).toFixed(1)}s`);

  try {
    await runCycle(true);
    if (stopping) {
      return;
    }

    watcher = chokidar.watch(root, {
      ignoreInitial: true,
      persistent: true,
      usePolling: settings.poll,
      ignored: (watchedPath) => {
        const relativePath = toPosixPath(path.relative(root, watchedPath));
        if (!relativePath) {
          return false;
        }
        if (relativePath === ".drop-ignore") {
          return false;
        }
        const segments = relativePath.split("/");
        return segments.some(
          (segment) =>
            segment === "node_modules" || segment === ".git" || segment.startsWith("."),
        );
      },
      awaitWriteFinish: settings.poll
        ? false
        : {
            stabilityThreshold: 200,
            pollInterval: 50,
          },
    });

    watcher.on("error", (error) => {
      printWarning(`File watcher error: ${error.message}`);
    });

    const ready = new Promise((resolve) => {
      watcher.once("ready", resolve);
      watcher.once("error", resolve);
    });

    watcher.on("all", (event, watchedPath) => {
      const relativePath = toPosixPath(path.relative(root, watchedPath));
      if (relativePath === ".drop-ignore") {
        ignoreMatcher = null;
        schedule();
        return;
      }
      if (isRelevantWatchEvent(event, relativePath)) {
        schedule();
      }
    });
    safetyTimer = setInterval(() => {
      schedule(0);
    }, Math.max(intervalMs * 5, 15_000));
    safetyTimer.unref?.();

    await Promise.race([ready, stopped]);
    if (stopping) {
      return;
    }
    printInfo("Press Ctrl+C to stop watching. The site stays online.");
    await stopped;
  } finally {
    stopping = true;
    controller.abort();
    if (timer) {
      clearTimeout(timer);
    }
    if (safetyTimer) {
      clearInterval(safetyTimer);
    }
    await watcher?.close();
    if (running) {
      await running.catch(() => {});
    }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  process.stdout.write("\n");
  if (config?.url) {
    printSuccess(`Stopped watching. Site remains online at ${color.cyan(config.url)}`);
  } else {
    printInfo("Stopped watching.");
  }
}
