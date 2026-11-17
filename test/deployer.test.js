import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { readConfig } from "../src/lib/config.js";
import { publishSnapshot } from "../src/lib/deployer.js";
import { scanSource } from "../src/lib/discovery.js";
import { DropApiError, DropConfigError } from "../src/lib/errors.js";
import {
  deploymentFixture,
  projectFixture,
  temporaryDirectory,
  writeTree,
} from "./helpers.js";

const TEST_PASSWORD = ["test", "password"].join("-");

function settingsFor(root, overrides = {}) {
  return {
    slug: "example-site",
    name: "Example site",
    visibility: "public",
    apiBase: "https://drop.micropue.com.cn/v1",
    password: undefined,
    explicitPassword: false,
    message: undefined,
    force: false,
    poll: false,
    intervalMs: 2000,
    ...overrides,
  };
}

function fakeClient({ deployConflictOnce = false } = {}) {
  const calls = [];
  let revision = 0;
  let deployAttempts = 0;
  return {
    calls,
    get callsCount() {
      return calls.length;
    },
    async createProject(payload, options) {
      calls.push({ method: "createProject", payload, options });
      revision = 1;
      return {
        project: projectFixture({
          name: payload.name,
          slug: payload.slug,
          visibility: payload.visibility,
          revision,
          hasPassword: payload.visibility === "password",
        }),
        deployment: deploymentFixture({
          revision,
          fileCount: payload.files.length,
          totalBytes: payload.files.reduce(
            (total, file) => total + Buffer.byteLength(file.content),
            0,
          ),
        }),
      };
    },
    async deployProject(projectId, payload, options) {
      calls.push({ method: "deployProject", projectId, payload, options });
      deployAttempts += 1;
      if (deployConflictOnce && deployAttempts === 1) {
        throw new DropApiError("Precondition failed", {
          status: 412,
          code: "revision_mismatch",
        });
      }
      revision = Math.max(revision + 1, (options.revision ?? 0) + 1);
      return {
        project: projectFixture({
          revision,
          name: "Example site",
          slug: "example-site",
          visibility: "public",
        }),
        deployment: deploymentFixture({
          id: `deployment-${revision}`,
          revision,
          fileCount: payload.files.length,
        }),
      };
    },
    async updateProject(projectId, payload, options) {
      calls.push({ method: "updateProject", projectId, payload, options });
      revision += 1;
      return projectFixture({
        revision,
        name: payload.name ?? "Example site",
        slug: payload.slug ?? "example-site",
        visibility: payload.visibility ?? "public",
      });
    },
    async getProject(projectId, options) {
      calls.push({ method: "getProject", projectId, options });
      return projectFixture({ revision: 8 });
    },
  };
}

async function publish(root, config, client, overrides = {}) {
  const snapshot = await scanSource(root);
  const settings = settingsFor(root, overrides);
  const result = await publishSnapshot({
    root,
    config,
    settings,
    snapshot,
    client,
  });
  return { result, snapshot, settings };
}

test("publishSnapshot creates once, skips no-ops and increments each mutation", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, { "index.html": "<h1>One</h1>" });
  const client = fakeClient();

  const first = await publish(root, null, client);

  assert.equal(first.result.created, true);
  assert.equal(first.result.config.version, 1);
  assert.equal(first.result.config.revision, 1);
  assert.equal(first.result.config.url, projectFixture().url);
  assert.equal(client.calls[0].method, "createProject");
  assert.equal(client.calls[0].payload.files[0].content, "<h1>One</h1>");
  assert.equal("password" in client.calls[0].payload, false);
  assert.equal(
    await readFile(path.join(root, ".drop/index.html"), "utf8"),
    "<h1>One</h1>",
  );
  assert.equal((await readConfig(root)).version, 1);

  const callsBeforeNoop = client.calls.length;
  const noop = await publish(root, first.result.config, client);
  assert.equal(noop.result.changed, false);
  assert.equal(noop.result.metadataChanged, false);
  assert.equal(noop.result.config.version, 1);
  assert.equal(client.calls.length, callsBeforeNoop);

  await writeFile(path.join(root, "index.html"), "<h1>Two</h1>");
  const contentOnly = await publish(root, first.result.config, client);
  assert.equal(contentOnly.result.changed, true);
  assert.equal(contentOnly.result.config.version, 2);
  assert.equal(
    client.calls.at(-1).payload.files[0].content,
    "<h1>Two</h1>",
  );

  await writeFile(path.join(root, "index.html"), "<h1>Three</h1>");
  const contentAndMetadata = await publish(
    root,
    contentOnly.result.config,
    client,
    { name: "Renamed site" },
  );
  assert.equal(contentAndMetadata.result.changed, true);
  assert.equal(contentAndMetadata.result.metadataChanged, true);
  assert.equal(contentAndMetadata.result.config.version, 3);
  assert.equal(contentAndMetadata.result.config.name, "Renamed site");
  assert.equal(
    client.calls.filter((call) => call.method === "deployProject").length,
    2,
  );
  assert.equal(
    client.calls.filter((call) => call.method === "updateProject").length,
    1,
  );

  const metadataOnly = await publish(
    root,
    contentAndMetadata.result.config,
    client,
    { name: "Renamed again" },
  );
  assert.equal(metadataOnly.result.changed, false);
  assert.equal(metadataOnly.result.metadataChanged, true);
  assert.equal(metadataOnly.result.config.version, 4);

  const forced = await publish(
    root,
    metadataOnly.result.config,
    client,
    { name: "Renamed again", force: true },
  );
  assert.equal(forced.result.changed, true);
  assert.equal(forced.result.config.version, 5);
});

test("publishSnapshot refreshes the revision and retries a 412 conflict", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, { "index.html": "<h1>One</h1>" });
  const initialClient = fakeClient();
  const first = await publish(root, null, initialClient);

  await writeFile(path.join(root, "index.html"), "<h1>Changed</h1>");
  const client = fakeClient({ deployConflictOnce: true });
  const result = await publish(root, first.result.config, client);

  assert.equal(result.result.config.revision, 9);
  assert.equal(result.result.config.version, 2);
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ["deployProject", "getProject", "deployProject"],
  );
  assert.equal(client.calls[0].options.revision, 1);
  assert.equal(client.calls[2].options.revision, 8);
});

test("publishSnapshot sends a password when creating a protected site", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, { "index.html": "<h1>Private</h1>" });
  const client = fakeClient();

  const result = await publish(root, null, client, {
    visibility: "password",
    password: TEST_PASSWORD,
    explicitPassword: true,
  });

  assert.equal(client.calls[0].payload.visibility, "password");
  assert.equal(client.calls[0].payload.password, TEST_PASSWORD);
  assert.equal(result.result.config.hasPassword, true);
});

test("publishSnapshot validates protected-site password length", async (t) => {
  const root = await temporaryDirectory(t);
  await writeTree(root, { "index.html": "<h1>Private</h1>" });

  await assert.rejects(
    publish(root, null, fakeClient(), {
      visibility: "password",
      password: "short",
      explicitPassword: true,
    }),
    (error) =>
      error instanceof DropConfigError &&
      error.message.includes("6-128 characters"),
  );
});
