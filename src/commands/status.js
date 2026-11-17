import { readConfig } from "../lib/config.js";
import { DropConfigError } from "../lib/errors.js";
import {
  color,
  printDropBanner,
  printInfo,
  printUrl,
} from "../lib/terminal.js";
import { formatBytes, humanTimestamp } from "../lib/utils.js";
import { resolveDirectory } from "../lib/runtime.js";

export async function statusCommand(directory) {
  const root = await resolveDirectory(directory);
  const config = await readConfig(root);
  if (!config) {
    throw new DropConfigError("No .drop/drop.json found.", {
      hint: "Run `drop init` or `drop watch` in the site directory.",
    });
  }

  printDropBanner();
  printInfo(`site       ${root}`);
  printInfo(`slug       ${color.bold(config.slug)}`);
  printInfo(`name       ${config.name}`);
  printInfo(
    `access     ${config.visibility === "password" ? "private (password)" : "public"}`,
  );
  printInfo(`version    v${config.version ?? 0}`);
  printInfo(`revision   ${config.revision ?? "not published"}`);
  printInfo(
    `files      ${config.files?.length ?? 0} · ${formatBytes(config.totalBytes ?? 0)}`,
  );
  printInfo(`folders    ${config.folders?.length ?? 0}`);
  printInfo(`deployed   ${humanTimestamp(config.deployedAt)}`);
  if (config.url) {
    printUrl(config.url);
  }
}
