import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  deploymentFixture,
  projectFixture,
  temporaryDirectory,
  writeTree,
} from "./helpers.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const testApiKey = ["fixture", "key"].join("-");
const testPassword = ["test", "password"].join("-");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(50);
  }
  throw new Error(`Condition was not met within ${timeoutMs} ms.`);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json",
    connection: "close",
  });
  response.end(JSON.stringify(payload));
}

test("drop watch publishes snapshots on change and stops cleanly", { timeout: 30_000 }, async (t) => {
  const siteRoot = await temporaryDirectory(t);
  await writeTree(siteRoot, {
    "index.html": "<h1>Initial</h1>",
    "assets/site.css": "body { color: black; }",
  });

  const requests = [];
  let revision = 0;
  let metadataUpdates = 0;
  let server;
  server = http.createServer(async (request, response) => {
    try {
      assert.equal(
        request.headers.authorization,
        `Bearer ${testApiKey}`,
      );
      if (request.method === "POST" && request.url === "/v1/projects") {
        const payload = await readJsonBody(request);
        requests.push({ method: "create", payload });
        revision = 1;
        sendJson(response, 201, {
          project: projectFixture({
            name: payload.name,
            slug: payload.slug,
            visibility: payload.visibility,
            hasPassword: payload.visibility === "password",
            revision,
          }),
          deployment: deploymentFixture({
            revision,
            fileCount: payload.files.length,
          }),
        });
        return;
      }
      if (
        request.method === "POST" &&
        request.url === "/v1/projects/project-1/deploy"
      ) {
        const payload = await readJsonBody(request);
        requests.push({ method: "deploy", payload });
        revision += 1;
        sendJson(response, 200, {
          project: projectFixture({
            name: requests[0].payload.name,
            slug: "integration-site",
            visibility: requests[0].payload.visibility,
            hasPassword: requests[0].payload.visibility === "password",
            revision,
          }),
          deployment: deploymentFixture({
            id: `deployment-${revision}`,
            revision,
            fileCount: payload.files.length,
          }),
        });
        return;
      }
      if (
        request.method === "PATCH" &&
        request.url === "/v1/projects/project-1"
      ) {
        const payload = await readJsonBody(request);
        requests.push({ method: "metadata", payload });
        metadataUpdates += 1;
        revision += 1;
        sendJson(response, 200, {
          project: projectFixture({
            name: requests[0].payload.name,
            slug: "integration-site",
            visibility: requests[0].payload.visibility,
            hasPassword: requests[0].payload.visibility === "password",
            revision,
          }),
        });
        return;
      }
      sendJson(response, 404, {
        title: "Not found",
        detail: `Unexpected request: ${request.method} ${request.url}`,
        status: 404,
        code: "not_found",
        requestId: "test-request",
      });
    } catch (error) {
      sendJson(response, 500, {
        title: "Test server error",
        detail: error.message,
        status: 500,
        code: "test_error",
        requestId: "test-request",
      });
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Local loopback listening is disabled in this sandbox.");
      return;
    }
    throw error;
  }
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const address = server.address();
  const apiBase = `http://127.0.0.1:${address.port}/v1`;

  const child = spawn(
    process.execPath,
    [
      path.join(projectRoot, "src/cli.js"),
      "watch",
      siteRoot,
      "--api-url",
      apiBase,
      "--slug",
      "integration-site",
      "--private",
      "--password",
      testPassword,
      "--interval",
      "500",
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        DROP_API_KEY: testApiKey,
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  });

  const waitForRequestCount = async (count) => {
    try {
      await waitFor(() => requests.length >= count);
    } catch (error) {
      throw new Error(
        [
          error.message,
          `expected ${count} requests, received ${requests.length}`,
          `requests: ${requests.map((request) => request.method).join(", ")}`,
          `stdout:\n${stdout}`,
          `stderr:\n${stderr}`,
        ].join("\n"),
      );
    }
  };

  await waitForRequestCount(1);
  assert.equal(requests[0].method, "create");
  assert.deepEqual(
    requests[0].payload.files.map((file) => file.path),
    ["assets/site.css", "index.html"],
  );
  assert.equal(requests[0].payload.visibility, "password");
  assert.equal(requests[0].payload.password, testPassword);
  assert.equal(requests[0].payload.files[1].content, "<h1>Initial</h1>");
  await waitFor(() => stdout.includes("Press Ctrl+C"));

  await writeFile(path.join(siteRoot, "index.html"), "<h1>Updated</h1>");
  await waitForRequestCount(2);
  assert.equal(requests[1].method, "deploy");
  assert.equal(requests[1].payload.files[1].content, "<h1>Updated</h1>");

  await mkdir(path.join(siteRoot, "new-folder"));
  await waitForRequestCount(3);
  assert.equal(
    requests[2].method,
    "deploy",
    JSON.stringify({
      requests: requests.map((request) => ({
        method: request.method,
        payload: request.payload,
      })),
      stdout,
      stderr,
    }),
  );
  assert.ok(requests[2].payload.folders.includes("new-folder"));

  await rm(path.join(siteRoot, "new-folder"), { recursive: true });
  await waitForRequestCount(4);
  assert.equal(requests[3].method, "deploy");
  assert.equal(requests[3].payload.folders.includes("new-folder"), false);

  const configPath = path.join(siteRoot, ".drop/drop.json");
  try {
    await waitFor(async () => {
      try {
        const value = JSON.parse(await readFile(configPath, "utf8"));
        return value.version === 4;
      } catch {
        return false;
      }
    });
  } catch (error) {
    assert.fail(
      [
        error.message,
        `requests: ${requests.map((request) => request.method).join(", ")}`,
        `stdout:\n${stdout}`,
        `stderr:\n${stderr}`,
      ].join("\n"),
    );
  }
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.slug, "integration-site");
  assert.equal(config.version, 4);
  assert.equal(config.revision, 4);
  assert.equal(config.url, projectFixture().url);
  assert.equal(config.hasPassword, true);
  assert.equal(
    await readFile(path.join(siteRoot, ".drop/index.html"), "utf8"),
    "<h1>Updated</h1>",
  );

  child.kill("SIGINT");
  const exit = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  assert.equal(exit.code, 0, stderr || stdout);
  assert.match(stdout, /Site remains online/);
  assert.equal(requests.length, 4);
  assert.equal(metadataUpdates, 0);

  await writeFile(path.join(siteRoot, "index.html"), "<h1>Deployed once</h1>");
  const deploy = spawn(
    process.execPath,
    [
      path.join(projectRoot, "src/cli.js"),
      "deploy",
      siteRoot,
      "--api-url",
      apiBase,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        DROP_API_KEY: testApiKey,
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let deployStdout = "";
  let deployStderr = "";
  deploy.stdout.setEncoding("utf8");
  deploy.stderr.setEncoding("utf8");
  deploy.stdout.on("data", (chunk) => {
    deployStdout += chunk;
  });
  deploy.stderr.on("data", (chunk) => {
    deployStderr += chunk;
  });
  const deployExit = await new Promise((resolve) => {
    deploy.once("exit", (code, signal) => resolve({ code, signal }));
  });

  assert.equal(deployExit.code, 0, deployStderr || deployStdout);
  assert.equal(requests.length, 5);
  assert.equal(requests[4].method, "deploy");
  assert.equal(
    requests[4].payload.files[1].content,
    "<h1>Deployed once</h1>",
  );
  const deployedConfig = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(deployedConfig.version, 5);
});
