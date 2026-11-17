const useColor =
  process.stdout.isTTY &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb";

function style(open, close, text) {
  return useColor ? `\u001b[${open}m${text}\u001b[${close}m` : String(text);
}

export const color = {
  bold: (text) => style("1", "22", text),
  dim: (text) => style("2", "22", text),
  cyan: (text) => style("36", "39", text),
  green: (text) => style("32", "39", text),
  yellow: (text) => style("33", "39", text),
  red: (text) => style("31", "39", text),
};

export function printDropBanner() {
  process.stdout.write(`${color.bold("DROP")} ${color.dim("· local site publisher")}\n`);
}

export function printInfo(message) {
  process.stdout.write(`${color.dim("│")} ${message}\n`);
}

export function printSuccess(message) {
  process.stdout.write(`${color.green("✓")} ${message}\n`);
}

export function printProgress(message) {
  process.stdout.write(`${color.cyan("›")} ${message}\n`);
}

export function printWarning(message) {
  process.stderr.write(`${color.yellow("!")} ${message}\n`);
}

export function printError(message) {
  process.stderr.write(`${color.red("✗")} ${message}\n`);
}

export function printUrl(url, label = "Live") {
  process.stdout.write(`${color.green("✓")} ${label}  ${color.cyan(url)}\n`);
}
