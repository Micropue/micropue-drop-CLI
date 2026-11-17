#!/usr/bin/env node

import { cac } from "cac";

import { loginCommand, logoutCommand, whoamiCommand } from "./commands/auth.js";
import { deployCommand } from "./commands/deploy.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { watchCommand } from "./commands/watch.js";
import { formatError, isAbortError } from "./lib/errors.js";
import { printError } from "./lib/terminal.js";
import { packageVersion } from "./lib/runtime.js";

function addPublishOptions(command) {
  return command
    .option("--slug <slug>", "DROP project slug")
    .option("--name <name>", "DROP project display name")
    .option("--visibility <visibility>", "public or password")
    .option("--private", "Shortcut for password-protected access")
    .option("--password <password>", "Password for a protected site")
    .option("--api-url <url>", "DROP API base URL")
    .option("--message <message>", "Deployment message");
}

export async function main(argv = process.argv) {
  const cli = cac("drop");
  let task;
  const action = (handler) => (...args) => {
    task = Promise.resolve().then(() => handler(...args));
  };

  addPublishOptions(
    cli
      .command("watch [directory]", "Watch a directory and publish changes")
      .option("--interval <ms>", "Deployment debounce interval in milliseconds")
      .option("--poll", "Use polling for the file watcher")
      .option("--force", "Deploy even when the content hash is unchanged"),
  ).action(action(watchCommand));

  addPublishOptions(
    cli
      .command("deploy [directory]", "Publish one complete snapshot and exit")
      .option("--force", "Deploy even when the content hash is unchanged"),
  ).action(action(deployCommand));

  cli
    .command("init [directory]", "Initialize .drop without publishing")
    .option("--slug <slug>", "DROP project slug")
    .option("--name <name>", "DROP project display name")
    .option("--visibility <visibility>", "public or password")
    .option("--private", "Shortcut for password-protected access")
    .action(action(initCommand));

  cli
    .command("status [directory]", "Show the local DROP deployment record")
    .action(action(statusCommand));

  cli
    .command("login", "Validate and save a DROP API key")
    .option("--api-url <url>", "DROP API base URL")
    .action(action(loginCommand));

  cli
    .command("logout", "Remove the saved DROP API key")
    .action(action(logoutCommand));

  cli
    .command("whoami", "Show the account connected to the current API key")
    .option("--api-url <url>", "DROP API base URL")
    .action(action(whoamiCommand));

  addPublishOptions(
    cli
      .command("[directory]", "Watch and publish the current directory")
      .option("--interval <ms>", "Deployment debounce interval in milliseconds")
      .option("--poll", "Use polling for the file watcher")
      .option("--force", "Deploy even when the content hash is unchanged"),
  ).action(action(watchCommand));

  cli.help();
  cli.version(await packageVersion());
  cli.parse(argv);
  if (task) {
    await task;
  }
}

main().catch((error) => {
  if (isAbortError(error)) {
    process.exitCode = 130;
    return;
  }
  printError(formatError(error));
  process.exitCode = error?.exitCode ?? 1;
});
