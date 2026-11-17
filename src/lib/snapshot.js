import { NO_SOURCE_FILES_CODE } from "./constants.js";
import { readConfig } from "./config.js";
import { scanDropBundle, scanSource } from "./discovery.js";
import { DropConfigError } from "./errors.js";
import { loadIgnoreMatcher } from "./ignore.js";

export async function loadSnapshot(root, { allowBundleFallback = true } = {}) {
  const matcher = await loadIgnoreMatcher(root);
  let sourceError;
  try {
    return await scanSource(root, { matcher });
  } catch (error) {
    if (error?.code !== NO_SOURCE_FILES_CODE) {
      throw error;
    }
    sourceError = error;
  }

  if (allowBundleFallback) {
    const bundle = await scanDropBundle(root);
    if (bundle) {
      return bundle;
    }
  }

  throw sourceError ?? new DropConfigError("No publishable files found.");
}

export async function loadWatchSnapshot(root, { initial = false } = {}) {
  if (initial) {
    return loadSnapshot(root, { allowBundleFallback: true });
  }
  return loadSnapshot(root, { allowBundleFallback: false });
}

export async function currentConfig(root) {
  return readConfig(root);
}
