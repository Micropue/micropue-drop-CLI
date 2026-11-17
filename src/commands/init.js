import { readConfig, syncDropBundle } from "../lib/config.js";
import { DropConfigError } from "../lib/errors.js";
import { loadSnapshot } from "../lib/snapshot.js";
import {
  printDropBanner,
  printInfo,
  printSuccess,
} from "../lib/terminal.js";
import {
  resolveDirectory,
  resolveSettings,
} from "../lib/runtime.js";

export async function initCommand(directory, options = {}) {
  const root = await resolveDirectory(directory);
  if (await readConfig(root)) {
    throw new DropConfigError("This directory already has .drop/drop.json.", {
      hint: "Run `drop status` or remove .drop manually before initializing again.",
    });
  }

  const settings = resolveSettings(root, options, null);
  const snapshot = await loadSnapshot(root, { allowBundleFallback: false });
  const now = new Date().toISOString();
  const config = {
    schemaVersion: 1,
    slug: settings.slug,
    name: settings.name,
    visibility: settings.visibility,
    version: 0,
    contentHash: snapshot.hash,
    files: snapshot.files.map(({ path: filePath, bytes, sha256 }) => ({
      path: filePath,
      bytes,
      sha256,
    })),
    folders: snapshot.folders,
    totalBytes: snapshot.totalBytes,
    createdAt: now,
    updatedAt: now,
  };

  await syncDropBundle(root, snapshot, config);
  printDropBanner();
  printSuccess(`Initialized .drop for ${settings.slug}`);
  printInfo(
    `${snapshot.files.length} files · ${snapshot.totalBytes} bytes · ${settings.visibility}`,
  );
  printInfo("Run `drop watch` when you are ready to publish.");
}
