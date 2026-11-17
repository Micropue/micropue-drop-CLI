import assert from "node:assert/strict";
import { access, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  incrementVersion,
  readConfig,
  syncDropBundle,
  writeConfig,
} from "../src/lib/config.js";
import { DropConfigError } from "../src/lib/errors.js";
import { scanSource } from "../src/lib/discovery.js";
import { temporaryDirectory, writeTree } from "./helpers.js";

function configFor(snapshot, overrides = {}) {
  return {
    schemaVersion: 1,
    slug: "example-site",
    name: "Example site",
    visibility: "public",
    version: 1,
    contentHash: snapshot.hash,
    files: snapshot.files.map(({ path: filePath, bytes, sha256 }) => ({
      path: filePath,
      bytes,
      sha256,
    })),
    folders: snapshot.folders,
    totalBytes: snapshot.totalBytes,
    updatedAt: "2026-11-17T00:00:00.000Z",
    ...overrides,
  };
}

test("syncDropBundle mirrors snapshots and removes stale files", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, {
    "index.html": "<h1>One</h1>",
    "old/page.css": "body { color: red; }",
  });
  const first = await scanSource(root);
  await syncDropBundle(root, first, configFor(first, { version: 1 }));

  assert.equal(
    await readFile(path.join(root, ".drop/index.html"), "utf8"),
    "<h1>One</h1>",
  );
  assert.equal(
    await readFile(path.join(root, ".drop/old/page.css"), "utf8"),
    "body { color: red; }",
  );
  assert.equal((await readConfig(root)).version, 1);

  await writeFile(path.join(root, "index.html"), "<h1>Two</h1>");
  await rm(path.join(root, "old"), { recursive: true, force: true });
  const second = await scanSource(root);
  await syncDropBundle(root, second, configFor(second, { version: 2 }));

  assert.equal(
    await readFile(path.join(root, ".drop/index.html"), "utf8"),
    "<h1>Two</h1>",
  );
  await assert.rejects(access(path.join(root, ".drop/old/page.css")));
  await assert.rejects(access(path.join(root, ".drop/old")));
  assert.equal((await readConfig(root)).version, 2);
  assert.deepEqual(
    (await readdir(path.join(root, ".drop"))).sort(),
    ["drop.json", "index.html"],
  );
});

test("syncDropBundle never deletes directories outside .drop", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, {
    "index.html": "<h1>Site</h1>",
    "outside/stale.html": "must remain",
    ".drop/stale.html": "stale bundle copy",
    ".drop/nested/old.html": "stale nested bundle copy",
  });
  const snapshot = await scanSource(root);

  await syncDropBundle(root, snapshot, configFor(snapshot));

  assert.equal(
    await readFile(path.join(root, "outside/stale.html"), "utf8"),
    "must remain",
  );
  await assert.rejects(access(path.join(root, ".drop/stale.html")));
  await assert.rejects(access(path.join(root, ".drop/nested")));
  assert.ok(await readFile(path.join(root, ".drop/index.html"), "utf8"));
});

test("readConfig rejects unrecognized schema versions and malformed JSON", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, {
    ".drop/drop.json": JSON.stringify({ schemaVersion: 2 }),
  });
  await assert.rejects(
    readConfig(root),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes("schemaVersion 1"),
  );

  await writeConfig(root, { schemaVersion: 1 });
  assert.equal((await readConfig(root)).schemaVersion, 1);

  await writeFile(path.join(root, ".drop/drop.json"), "{not-json");
  await assert.rejects(
    readConfig(root),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes("not valid JSON"),
  );
});

test("incrementVersion starts at one and only advances from valid versions", () => {
  assert.equal(incrementVersion(undefined), 1);
  assert.equal(incrementVersion(0), 1);
  assert.equal(incrementVersion(4), 5);
  assert.equal(incrementVersion(-2), 1);
  assert.equal(incrementVersion(1.5), 1);
});
