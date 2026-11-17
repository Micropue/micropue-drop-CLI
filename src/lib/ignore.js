import { readFile } from "node:fs/promises";
import path from "node:path";

import ignore from "ignore";

import { IGNORE_FILE_NAME } from "./constants.js";
import { DropConfigError } from "./errors.js";
import { toPosixPath } from "./utils.js";

export async function loadIgnoreMatcher(root) {
  const ignoreFile = path.join(root, IGNORE_FILE_NAME);
  let contents = "";

  try {
    contents = await readFile(ignoreFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new DropConfigError(`Could not read ${IGNORE_FILE_NAME}`, {
        cause: error,
      });
    }
  }

  const matcher = ignore();
  try {
    matcher.add(contents);
  } catch (error) {
    throw new DropConfigError(`Invalid ${IGNORE_FILE_NAME}`, {
      cause: error,
      hint: "Use gitignore-style patterns, one per line.",
    });
  }

  return {
    source: contents,
    isIgnored(relativePath, isDirectory = false) {
      if (!relativePath) {
        return false;
      }
      const normalized = toPosixPath(relativePath);
      try {
        return matcher.ignores(isDirectory ? `${normalized}/` : normalized);
      } catch {
        return false;
      }
    },
  };
}
