import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function temporaryDirectory(test) {
  const root = await mkdtemp(path.join(os.tmpdir(), "drop-cli-test-"));
  test.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

export async function writeTree(root, tree) {
  for (const [relativePath, content] of Object.entries(tree)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

export function projectFixture(overrides = {}) {
  return {
    id: "project-1",
    name: "Example site",
    slug: "example-site",
    path: "/micropue/example-site/",
    url: "https://drop.micropue.com.cn/micropue/example-site/",
    visibility: "public",
    enabled: true,
    revision: 1,
    hasPassword: false,
    folders: [],
    files: [],
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    lastDeployedAt: "2026-11-17T00:00:00.000Z",
    ...overrides,
  };
}

export function deploymentFixture(overrides = {}) {
  return {
    id: "deployment-1",
    revision: 1,
    status: "live",
    url: "https://drop.micropue.com.cn/micropue/example-site/",
    fileCount: 1,
    totalBytes: 10,
    source: "api",
    createdAt: "2026-11-17T00:00:00.000Z",
    ...overrides,
  };
}

export function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(payload === null ? null : JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}
