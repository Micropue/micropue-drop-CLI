import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  DROP_DIR_NAME,
  IGNORE_FILE_NAME,
  LIMITS,
  NO_SOURCE_FILES_CODE,
  SUPPORTED_EXTENSIONS,
} from "./constants.js";
import { DropConfigError } from "./errors.js";
import { loadIgnoreMatcher } from "./ignore.js";
import {
  foldersFromFiles,
  hasWrongCaseSupportedExtension,
  isInside,
  sha256,
  snapshotHash,
  toPosixPath,
  validateRelativeFilePath,
} from "./utils.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

function defaultExcluded(relativePath, isDirectory) {
  const segments = relativePath.split("/");
  if (segments[0] === DROP_DIR_NAME) {
    return true;
  }
  if (segments.some((segment) => segment === "node_modules" || segment === ".git")) {
    return true;
  }
  return segments.some((segment) => segment.startsWith(".")) && !isDirectory;
}

function hiddenPath(relativePath) {
  return relativePath.split("/").some((segment) => segment.startsWith("."));
}

async function readSiteFile(absolutePath, relativePath) {
  const buffer = await readFile(absolutePath);
  if (buffer.length > LIMITS.fileBytes) {
    throw new DropConfigError(
      `File exceeds the ${LIMITS.fileBytes} byte limit: ${relativePath}`,
      {
        hint: `The current size is ${buffer.length} bytes.`,
      },
    );
  }

  let content;
  try {
    content = decoder.decode(buffer);
  } catch {
    throw new DropConfigError(`File is not valid UTF-8: ${relativePath}`);
  }

  return {
    path: relativePath,
    content,
    bytes: buffer.length,
    sha256: null,
  };
}

async function walkFiles(root, relativeDir, matcher, state) {
  const absoluteDir = relativeDir ? path.join(root, relativeDir) : root;
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;
    const absolutePath = path.join(root, relativePath);

    if (!isInside(root, absolutePath) || absolutePath === root) {
      continue;
    }

    if (entry.name === IGNORE_FILE_NAME) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      if (!hiddenPath(relativePath) && state.warnings.length < 10) {
        state.warnings.push(`Skipped symbolic link: ${relativePath}`);
      }
      continue;
    }

    if (entry.isDirectory()) {
      if (defaultExcluded(relativePath, true) || hiddenPath(relativePath)) {
        continue;
      }
      if (matcher?.isIgnored(relativePath, true)) {
        continue;
      }
      state.folders.add(relativePath);
      if (state.folders.size > LIMITS.folders) {
        throw new DropConfigError(
          `Project contains more than ${LIMITS.folders} folders.`,
          { hint: "Simplify the directory tree or exclude folders in .drop-ignore." },
        );
      }
      await walkFiles(root, relativePath, matcher, state);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (defaultExcluded(relativePath, false) || hiddenPath(relativePath)) {
      continue;
    }

    if (matcher?.isIgnored(relativePath, false)) {
      state.ignoredCount += 1;
      continue;
    }

    if (hasWrongCaseSupportedExtension(relativePath)) {
      throw new DropConfigError(
        `File extensions must be lowercase: ${relativePath}`,
        { hint: "Rename .HTML, .CSS or .JS files before publishing." },
      );
    }

    if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
      state.unsupportedCount += 1;
      continue;
    }

    const pathError = validateRelativeFilePath(relativePath);
    if (pathError) {
      throw new DropConfigError(pathError);
    }

    const file = await readSiteFile(absolutePath, relativePath);
    state.files.push(file);
    if (state.files.length > LIMITS.files) {
      throw new DropConfigError(
        `Project contains more than ${LIMITS.files} publishable files.`,
        { hint: "DROP only accepts 20 .html, .css or .js files per project." },
      );
    }
  }
}

function validateTotalSize(files) {
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  if (totalBytes > LIMITS.projectBytes) {
    throw new DropConfigError(
      `Project size exceeds the ${LIMITS.projectBytes} byte limit.`,
      {
        hint: `The current total is ${totalBytes} bytes.`,
      },
    );
  }
  return totalBytes;
}

function finalizeSnapshot(files, folders, warnings, unsupportedCount, ignoredCount) {
  files.sort((left, right) => left.path.localeCompare(right.path));
  const cleanFiles = files.map((file) => ({
    ...file,
    sha256: file.sha256 ?? sha256(file.content),
  }));
  const totalBytes = validateTotalSize(cleanFiles);
  const folderList = [...new Set([...folders, ...foldersFromFiles(cleanFiles)])].sort();
  if (folderList.length > LIMITS.folders) {
    throw new DropConfigError(
      `Project contains more than ${LIMITS.folders} folders.`,
    );
  }
  return {
    files: cleanFiles,
    folders: folderList,
    totalBytes,
    hash: snapshotHash(cleanFiles, folderList),
    warnings,
    unsupportedCount,
    ignoredCount,
  };
}

export async function scanSource(root, { matcher } = {}) {
  const ignoreMatcher = matcher ?? (await loadIgnoreMatcher(root));
  const state = {
    files: [],
    folders: new Set(),
    warnings: [],
    unsupportedCount: 0,
    ignoredCount: 0,
  };
  await walkFiles(root, "", ignoreMatcher, state);
  if (state.files.length === 0) {
    throw new DropConfigError(
      "No .html, .css or .js files found to publish.",
      {
        code: NO_SOURCE_FILES_CODE,
        hint: "Run this command from the site root or check .drop-ignore.",
      },
    );
  }
  return finalizeSnapshot(
    state.files,
    state.folders,
    state.warnings,
    state.unsupportedCount,
    state.ignoredCount,
  );
}

export async function scanDropBundle(root) {
  const dropRoot = path.join(root, DROP_DIR_NAME);
  let configStat;
  try {
    configStat = await lstat(path.join(dropRoot, "drop.json"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!configStat.isFile()) {
    return null;
  }

  const state = {
    files: [],
    folders: new Set(),
    warnings: [],
    unsupportedCount: 0,
    ignoredCount: 0,
  };

  async function walk(relativeDir) {
    const absoluteDir = relativeDir
      ? path.join(dropRoot, relativeDir)
      : dropRoot;
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (relativePath === "drop.json") {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolutePath = path.join(dropRoot, relativePath);
      if (entry.isDirectory()) {
        if (hiddenPath(relativePath)) {
          continue;
        }
        state.folders.add(relativePath);
        await walk(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (hiddenPath(relativePath)) {
        state.unsupportedCount += 1;
        continue;
      }
      if (hasWrongCaseSupportedExtension(relativePath)) {
        throw new DropConfigError(
          `File extensions must be lowercase: ${relativePath}`,
          { hint: "Rename .HTML, .CSS or .JS files before publishing." },
        );
      }
      if (!SUPPORTED_EXTENSIONS.has(path.extname(relativePath))) {
        state.unsupportedCount += 1;
        continue;
      }
      const pathError = validateRelativeFilePath(relativePath);
      if (pathError) {
        throw new DropConfigError(pathError);
      }
      state.files.push(await readSiteFile(absolutePath, relativePath));
    }
  }

  await walk("");
  if (state.files.length === 0) {
    return null;
  }
  return finalizeSnapshot(
    state.files,
    state.folders,
    state.warnings,
    state.unsupportedCount,
    state.ignoredCount,
  );
}

export function stripFileContent(snapshot) {
  return {
    ...snapshot,
    files: snapshot.files.map(({ path: filePath, bytes, sha256 }) => ({
      path: filePath,
      bytes,
      sha256,
    })),
  };
}

export function remoteFiles(snapshot) {
  return snapshot.files.map((file) => ({
    path: file.path,
    content: file.content,
  }));
}

export { toPosixPath };
