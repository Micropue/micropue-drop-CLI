import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { LIMITS } from "../src/lib/constants.js";
import { scanDropBundle, scanSource } from "../src/lib/discovery.js";
import { DropConfigError } from "../src/lib/errors.js";
import { temporaryDirectory, writeTree } from "./helpers.js";

test("scanSource discovers supported files and excludes ignored paths", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, {
    "index.html": "<h1>Home</h1>",
    "app.js": "console.log('ok');",
    "assets/site.css": "body { color: black; }",
    "ignored/drop.html": "ignored",
    "ignored/keep.html": "kept",
    "assets/skip.css": "ignored",
    "notes.tmp.html": "ignored",
    ".hidden.html": "hidden",
    ".secret/private.html": "hidden",
    "node_modules/pkg/index.html": "dependency",
    ".git/config.js": "git metadata",
    ".drop/index.html": "stored bundle",
    "README.md": "not publishable",
    ".drop-ignore":
      "ignored/*.html\n!ignored/keep.html\nassets/skip.css\nnotes.tmp.html\n",
  });
  await symlink("index.html", path.join(root, "linked.html"));

  const snapshot = await scanSource(root);

  assert.deepEqual(
    snapshot.files.map((file) => file.path),
    ["app.js", "assets/site.css", "ignored/keep.html", "index.html"],
  );
  assert.equal(snapshot.ignoredCount, 3);
  assert.equal(snapshot.unsupportedCount, 1);
  assert.deepEqual(snapshot.folders, ["assets", "ignored"]);
  assert.deepEqual(snapshot.warnings, ["Skipped symbolic link: linked.html"]);
  assert.equal(snapshot.files[0].sha256.length, 64);
  assert.equal(snapshot.totalBytes, Buffer.byteLength(
    "<h1>Home</h1>console.log('ok');body { color: black; }kept",
  ));
});

test("scanSource includes empty folders in the snapshot hash", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, { "index.html": "<h1>Home</h1>" });
  await mkdir(path.join(root, "empty-one"));

  const first = await scanSource(root);
  await mkdir(path.join(root, "empty-two"));
  const second = await scanSource(root);

  assert.deepEqual(first.folders, ["empty-one"]);
  assert.deepEqual(second.folders, ["empty-one", "empty-two"]);
  assert.notEqual(first.hash, second.hash);
});

test("scanSource rejects uppercase supported extensions", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, { "INDEX.HTML": "<h1>Uppercase</h1>" });

  await assert.rejects(
    scanSource(root),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes("lowercase"),
  );
});

test("scanSource rejects invalid UTF-8", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, { "index.html": Buffer.from([0xff, 0xfe, 0xfd]) });

  await assert.rejects(
    scanSource(root),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes("valid UTF-8"),
  );
});

test("scanSource enforces file size, count and project size limits", async (t) => {
  const fileLimitRoot = await temporaryDirectory(t);
  await writeTree(fileLimitRoot, {
    "large.html": Buffer.alloc(LIMITS.fileBytes + 1, 0x61),
  });
  await assert.rejects(
    scanSource(fileLimitRoot),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes("byte limit"),
  );

  const countRoot = await temporaryDirectory(t);
  const countTree = {};
  for (let index = 0; index <= LIMITS.files; index += 1) {
    countTree[`page-${index}.html`] = "<p>page</p>";
  }
  await writeTree(countRoot, countTree);
  await assert.rejects(
    scanSource(countRoot),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes(`more than ${LIMITS.files}`),
  );

  const sizeRoot = await temporaryDirectory(t);
  await writeTree(sizeRoot, {
    "one.html": Buffer.alloc(400 * 1024, 0x61),
    "two.html": Buffer.alloc(400 * 1024, 0x62),
    "three.html": Buffer.alloc(400 * 1024, 0x63),
  });
  await assert.rejects(
    scanSource(sizeRoot),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes("Project size exceeds"),
  );
});

test("scanSource enforces folder count and path length limits", async (t) => {
  const folderRoot = await temporaryDirectory(t);
  for (let index = 0; index <= LIMITS.folders; index += 1) {
    await mkdir(path.join(folderRoot, `folder-${index}`));
  }
  await writeFile(path.join(folderRoot, "index.html"), "<h1>Home</h1>");
  await assert.rejects(
    scanSource(folderRoot),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes("more than 50 folders"),
  );

  const pathRoot = await temporaryDirectory(t);
  const longFolder = "a".repeat(121);
  await writeTree(pathRoot, {
    [`${longFolder}/index.html`]: "<h1>Long</h1>",
  });
  await assert.rejects(
    scanSource(pathRoot),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes("exceeds 120 characters"),
  );
});

test("scanDropBundle reads the persisted .drop bundle", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, {
    ".drop/drop.json": "{}\n",
    ".drop/index.html": "<h1>Stored</h1>",
    ".drop/assets/style.css": "body {}",
    ".drop/.private.html": "hidden",
    ".drop/README.md": "unsupported",
  });

  const snapshot = await scanDropBundle(root);

  assert.deepEqual(
    snapshot.files.map((file) => file.path),
    ["assets/style.css", "index.html"],
  );
  assert.deepEqual(snapshot.folders, ["assets"]);
  assert.equal(snapshot.unsupportedCount, 2);
  assert.equal(snapshot.files[1].content, "<h1>Stored</h1>");
});
