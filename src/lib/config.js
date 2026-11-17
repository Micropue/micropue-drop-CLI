import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  CONFIG_FILE_NAME,
  CONFIG_SCHEMA_VERSION,
  DROP_DIR_NAME,
} from "./constants.js";
import { DropConfigError } from "./errors.js";
import { isInside, resolveInside } from "./utils.js";

export function dropPaths(root) {
  const directory = path.join(root, DROP_DIR_NAME);
  return {
    directory,
    config: path.join(directory, CONFIG_FILE_NAME),
  };
}

export async function readConfig(root) {
  const { config: configPath } = dropPaths(root);
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new DropConfigError("Could not read .drop/drop.json", {
      cause: error,
    });
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new DropConfigError(".drop/drop.json is not valid JSON", {
      cause: error,
    });
  }

  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    config.schemaVersion !== CONFIG_SCHEMA_VERSION
  ) {
    throw new DropConfigError(
      `Unsupported .drop/drop.json schema. Expected schemaVersion ${CONFIG_SCHEMA_VERSION}.`,
    );
  }

  return config;
}

async function atomicWrite(filePath, content) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function writeConfig(root, config) {
  const { directory, config: configPath } = dropPaths(root);
  await mkdir(directory, { recursive: true });
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  await atomicWrite(configPath, serialized);
}

async function collectBundleFiles(dropRoot, relativeDir = "") {
  const absoluteDir = relativeDir
    ? path.join(dropRoot, relativeDir)
    : dropRoot;
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;
    if (relativeDir === "" && relativePath === CONFIG_FILE_NAME) {
      continue;
    }
    const absolutePath = path.join(dropRoot, relativePath);
    if (entry.isDirectory()) {
      directories.push(relativePath);
      const nested = await collectBundleFiles(dropRoot, relativePath);
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else {
      files.push({ relativePath, absolutePath });
    }
  }
  return { files, directories };
}

async function pruneEmptyDirectories(dropRoot, directories, expectedFolders) {
  directories.sort((left, right) => right.length - left.length);
  for (const relativeDir of directories) {
    if (expectedFolders.has(relativeDir)) {
      continue;
    }
    const absoluteDir = resolveInside(dropRoot, relativeDir);
    if (!isInside(dropRoot, absoluteDir) || absoluteDir === dropRoot) {
      throw new DropConfigError(`Unsafe folder path: ${relativeDir}`);
    }
    try {
      await rmdir(absoluteDir);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
        throw error;
      }
    }
  }
}

export async function syncDropBundle(root, snapshot, config) {
  const { directory: dropRoot } = dropPaths(root);
  await mkdir(dropRoot, { recursive: true });

  const existing = await collectBundleFiles(dropRoot);
  const expected = new Set(snapshot.files.map((file) => file.path));
  const expectedFolders = new Set(snapshot.folders);

  for (const file of snapshot.files) {
    const target = resolveInside(dropRoot, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await atomicWrite(target, file.content);
  }

  for (const folder of snapshot.folders) {
    const target = resolveInside(dropRoot, folder);
    if (!isInside(dropRoot, target)) {
      throw new DropConfigError(`Unsafe folder path: ${folder}`);
    }
    await mkdir(target, { recursive: true });
  }

  for (const file of existing.files) {
    if (!expected.has(file.relativePath)) {
      await rm(file.absolutePath, { force: true });
    }
  }

  await pruneEmptyDirectories(dropRoot, existing.directories, expectedFolders);
  await writeConfig(root, config);
}

export function incrementVersion(previousVersion) {
  return Number.isSafeInteger(previousVersion) && previousVersion >= 0
    ? previousVersion + 1
    : 1;
}
