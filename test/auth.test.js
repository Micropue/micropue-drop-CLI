import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  readStoredKey,
  resolveApiKey,
} from "../src/lib/auth.js";
import { temporaryDirectory } from "./helpers.js";

function preserveAuthEnvironment(t) {
  const previousKey = process.env.DROP_API_KEY;
  const previousAuthFile = process.env.DROP_AUTH_FILE;

  t.after(() => {
    if (previousKey === undefined) {
      delete process.env.DROP_API_KEY;
    } else {
      process.env.DROP_API_KEY = previousKey;
    }

    if (previousAuthFile === undefined) {
      delete process.env.DROP_AUTH_FILE;
    } else {
      process.env.DROP_AUTH_FILE = previousAuthFile;
    }
  });
}

test("an API key entered interactively is saved automatically", async (t) => {
  preserveAuthEnvironment(t);
  delete process.env.DROP_API_KEY;

  const root = await temporaryDirectory(t);
  const authPath = path.join(root, "micropue-drop", "auth.json");
  process.env.DROP_AUTH_FILE = authPath;

  const key = await resolveApiKey({
    interactive: true,
    prompt: async (label) => {
      assert.equal(label, "DROP API key");
      return "  prompted-key  ";
    },
  });

  assert.equal(key, "prompted-key");
  assert.equal(await readStoredKey(), "prompted-key");

  const saved = JSON.parse(await readFile(authPath, "utf8"));
  assert.equal(saved.apiKey, "prompted-key");
  assert.match(saved.savedAt, /^\d{4}-\d{2}-\d{2}T/);

  if (process.platform !== "win32") {
    assert.equal((await stat(authPath)).mode & 0o777, 0o600);
  }
});

test("an API key from the environment is not persisted implicitly", async (t) => {
  preserveAuthEnvironment(t);

  const root = await temporaryDirectory(t);
  const authPath = path.join(root, "micropue-drop", "auth.json");
  process.env.DROP_API_KEY = "environment-key";
  process.env.DROP_AUTH_FILE = authPath;

  const key = await resolveApiKey({
    interactive: true,
    prompt: async () => {
      throw new Error("The prompt must not run when an environment key exists.");
    },
  });

  assert.equal(key, "environment-key");
  await assert.rejects(access(authPath), { code: "ENOENT" });
});
