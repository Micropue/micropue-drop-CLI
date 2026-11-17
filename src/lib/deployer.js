import { randomUUID } from "node:crypto";

import { incrementVersion, syncDropBundle } from "./config.js";
import { remoteFiles, stripFileContent } from "./discovery.js";
import { DropApiError, DropConfigError } from "./errors.js";
import { metadataChanged } from "./runtime.js";

function uniqueMessage(snapshot, version, customMessage) {
  if (customMessage) {
    return customMessage;
  }
  return `DROP CLI · v${version} · ${snapshot.files.length} files`;
}

function requiredPassword(settings, previous) {
  if (settings.visibility !== "password") {
    return undefined;
  }
  if (settings.password) {
    return settings.password;
  }
  if (!previous?.projectId || previous.visibility !== "password") {
    throw new DropConfigError("A password is required for a protected site.", {
      hint: "Pass --password, set DROP_PASSWORD, or use the interactive prompt.",
    });
  }
  return undefined;
}

function resolvePassword(settings, previous) {
  if (settings.visibility !== "password") {
    return undefined;
  }
  const needsPassword =
    !previous?.projectId ||
    previous.visibility !== "password" ||
    settings.explicitPassword;
  if (!needsPassword) {
    return undefined;
  }
  const password =
    settings.password ??
    (process.env.DROP_PASSWORD?.trim() || undefined);
  if (password === undefined) {
    return requiredPassword(settings, previous);
  }
  if (password.length < 6 || password.length > 128) {
    throw new DropConfigError("Site password must contain 6-128 characters.");
  }
  return password;
}

function metadataPayload(settings, previous) {
  const payload = {};
  if (previous.name !== settings.name) {
    payload.name = settings.name;
  }
  if (previous.slug !== settings.slug) {
    payload.slug = settings.slug;
  }
  if (previous.visibility !== settings.visibility) {
    payload.visibility = settings.visibility;
  }
  return payload;
}

async function retryOnRevisionConflict(operation, client, projectId, signal) {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof DropApiError) || error.status !== 412) {
      throw error;
    }
    const fresh = await client.getProject(projectId, { signal });
    return operation(fresh.revision);
  }
}

function nextConfig({
  previous,
  settings,
  snapshot,
  project,
  deployment,
  version,
  contentChanged,
}) {
  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    slug: project.slug,
    name: project.name,
    visibility: project.visibility,
    projectId: project.id,
    url: project.url,
    revision: project.revision,
    version,
    contentHash: snapshot.hash,
    files: stripFileContent(snapshot).files,
    folders: snapshot.folders,
    totalBytes: snapshot.totalBytes,
    hasPassword: project.hasPassword ?? previous?.hasPassword ?? false,
    enabled: project.enabled ?? previous?.enabled ?? true,
    deploymentId: deployment?.id ?? previous?.deploymentId,
    apiBase: settings.apiBase,
    createdAt: previous?.createdAt ?? project.createdAt ?? now,
    updatedAt: project.updatedAt ?? now,
    deployedAt: contentChanged
      ? deployment?.createdAt ?? now
      : previous?.deployedAt,
  };
}

export async function publishSnapshot({
  root,
  config: previous,
  settings,
  snapshot,
  client,
  onProgress = () => {},
  signal,
}) {
  const password = resolvePassword(settings, previous);
  const contentChanged =
    settings.force ||
    !previous?.projectId ||
    previous.contentHash !== snapshot.hash;
  const metadataIsChanged = metadataChanged(previous, settings);

  if (!contentChanged && !metadataIsChanged) {
    return {
      changed: false,
      metadataChanged: false,
      created: false,
      config: previous,
      snapshot,
    };
  }

  const version = previous?.projectId
    ? incrementVersion(previous.version)
    : 1;
  let project;
  let deployment;
  let created = false;

  if (!previous?.projectId) {
    onProgress(`Creating project ${settings.slug} · ${snapshot.files.length} files`);
    const payload = {
      name: settings.name,
      slug: settings.slug,
      visibility: settings.visibility,
      enabled: true,
      files: remoteFiles(snapshot),
      folders: snapshot.folders,
      message: uniqueMessage(snapshot, version, settings.message),
    };
    if (password) {
      payload.password = password;
    }
    const response = await client.createProject(payload, {
      idempotencyKey: randomUUID(),
      signal,
    });
    project = response.project;
    deployment = response.deployment;
    created = true;
  } else {
    project = {
      id: previous.projectId,
      slug: previous.slug,
      name: previous.name,
      visibility: previous.visibility,
      url: previous.url,
      revision: previous.revision,
      hasPassword: previous.hasPassword,
      enabled: previous.enabled,
      createdAt: previous.createdAt,
      updatedAt: previous.updatedAt,
    };

    if (contentChanged) {
      onProgress(
        `Publishing v${version} · ${snapshot.files.length} files · ${snapshot.totalBytes} bytes`,
      );
      const payload = {
        files: remoteFiles(snapshot),
        folders: snapshot.folders,
        message: uniqueMessage(snapshot, version, settings.message),
      };
      const response = await retryOnRevisionConflict(
        (revision = project.revision) =>
          client.deployProject(previous.projectId, payload, {
            revision,
            idempotencyKey: randomUUID(),
            signal,
          }),
        client,
        previous.projectId,
        signal,
      );
      project = response.project;
      deployment = response.deployment;
    }

    const metadata = metadataPayload(settings, project);
    if (password) {
      metadata.password = password;
    }
    if (Object.keys(metadata).length > 0) {
      onProgress(`Updating project metadata`);
      project = await retryOnRevisionConflict(
        (revision = project.revision) =>
          client.updateProject(previous.projectId, metadata, {
            revision,
            idempotencyKey: randomUUID(),
            signal,
          }),
        client,
        previous.projectId,
        signal,
      );
    }
  }

  const config = nextConfig({
    previous,
    settings,
    snapshot,
    project,
    deployment,
    version,
    contentChanged,
  });

  await syncDropBundle(root, snapshot, config);

  return {
    changed: contentChanged,
    metadataChanged: metadataIsChanged,
    created,
    config,
    snapshot,
    project,
    deployment,
  };
}
