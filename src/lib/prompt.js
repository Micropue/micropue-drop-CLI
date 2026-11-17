import readline from "node:readline";

import { DropConfigError } from "./errors.js";

export function promptHidden(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new DropConfigError(`${label} requires an interactive terminal.`);
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    process.stdout.write(`${label}: `);
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const finish = (error, result) => {
      cleanup();
      process.stdout.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const onKeypress = (character, key) => {
      if (key?.ctrl && key.name === "c") {
        finish(new DropConfigError("Cancelled."));
        return;
      }
      if (key?.name === "return" || key?.name === "enter") {
        finish(null, value);
        return;
      }
      if (key?.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (character && !key?.ctrl && !key?.meta) {
        value += character;
        process.stdout.write("*");
      }
    };

    stdin.on("keypress", onKeypress);
  });
}
