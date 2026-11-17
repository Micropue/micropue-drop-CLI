export const PACKAGE_NAME = "@micropue/drop-cli";
export const DEFAULT_API_BASE = "https://drop.micropue.com.cn/v1";
export const DROP_DIR_NAME = ".drop";
export const CONFIG_FILE_NAME = "drop.json";
export const IGNORE_FILE_NAME = ".drop-ignore";
export const CONFIG_SCHEMA_VERSION = 1;
export const NO_SOURCE_FILES_CODE = "no_source_files";

export const SUPPORTED_EXTENSIONS = new Set([".html", ".css", ".js"]);

export const LIMITS = Object.freeze({
  files: 20,
  fileBytes: 512 * 1024,
  projectBytes: 1024 * 1024,
  folders: 50,
  pathLength: 120,
});

export const DEFAULT_INTERVAL_MS = 2_000;
export const MIN_INTERVAL_MS = 500;
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
export const MAX_REQUEST_TIMEOUT_MS = 120_000;
