/**
 * Putting the bridge into someone else's project, and taking it back out.
 *
 * The bridge lives in its own GameMaker project under `bridge/mcp_bridge`,
 * where it can be opened, run and debugged. Injection copies the GML, NOT the
 * `.yy` files: resources are re-created through the normal project API so they
 * adopt the target project's own conventions. Copying `.yy` files verbatim
 * would push our authoring version's format into a project that may be on a
 * different GameMaker release — the version-drift problem this codebase avoids
 * everywhere else.
 *
 * Eject must return the project to exactly the bytes it had before injection.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createFolder,
  createObject,
  createScript,
  deleteResource,
  eventFileName,
  GmProject,
  listEvents,
  ProjectError,
  type GmEvent,
} from '../project/index.js';
import type { Transaction } from '../tx/index.js';
import { BRIDGE_PROTOCOL } from './client.js';

/** Folder the bridge's resources are filed under in the target project. */
export const BRIDGE_FOLDER = 'GmlMcp';

export interface BridgeManifest {
  protocol: number;
  /** Resources copied into a target project. */
  inject: string[];
  /** Resources that exist only for developing the bridge. */
  dev: string[];
}

/**
 * Locate the bridge project shipped with this package.
 *
 * `src/bridge/` and `dist/bridge/` sit at the same depth, so one relative
 * path serves both a source run and a built one.
 */
export function bridgeRoot(): string {
  const override = process.env.GML_MCP_BRIDGE_ROOT;
  if (override) return override;
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bridge');
}

export function loadManifest(): BridgeManifest {
  const path = join(bridgeRoot(), 'manifest.json');
  if (!existsSync(path)) throw new ProjectError(`Bridge manifest not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as BridgeManifest;
}

export function bridgeProject(): GmProject {
  return GmProject.open(join(bridgeRoot(), 'mcp_bridge'));
}

export interface BridgeStatus {
  installed: boolean;
  /** Manifest resources already present in the target. */
  present: string[];
  /** Manifest resources missing from the target. */
  missing: string[];
  /** Protocol version this server ships. */
  protocol: number;
}

export function bridgeStatus(project: GmProject, tx?: Transaction): BridgeStatus {
  const manifest = loadManifest();
  const present = manifest.inject.filter((name) => project.has(name, tx));
  return {
    installed: present.length === manifest.inject.length,
    present,
    missing: manifest.inject.filter((name) => !project.has(name, tx)),
    protocol: BRIDGE_PROTOCOL,
  };
}

/**
 * Copy the bridge into `project`.
 *
 * Re-injecting over an existing copy is allowed and updates it; colliding
 * with something the user wrote is not.
 */
export function injectBridge(project: GmProject, tx: Transaction): string[] {
  const manifest = loadManifest();
  const source = bridgeProject();

  const status = bridgeStatus(project, tx);
  if (status.present.length > 0 && !status.installed) {
    throw new ProjectError(
      `The project has a partial bridge (${status.present.join(', ')}). ` +
        'Eject it before injecting again.',
    );
  }
  if (status.installed) ejectBridge(project, tx);

  createFolder(project, tx, BRIDGE_FOLDER);
  const created: string[] = [];

  for (const name of manifest.inject) {
    const resource = source.find(name);
    if (!resource) throw new ProjectError(`Bridge manifest names a missing resource: ${name}`);

    if (resource.kind === 'scripts') {
      const code = source.readText(`scripts/${name}/${name}.gml`);
      if (code === undefined) throw new ProjectError(`Bridge script ${name} has no .gml`);
      createScript(project, tx, name, code, { folder: BRIDGE_FOLDER });
      created.push(name);
      continue;
    }

    if (resource.kind === 'objects') {
      const definition = source.readDoc(resource.path);
      const events = listEvents(source, name).map((event: GmEvent) => {
        const code = source.readText(`objects/${name}/${eventFileName(event)}`);
        if (code === undefined) {
          throw new ProjectError(`Bridge object ${name} is missing ${eventFileName(event)}`);
        }
        return { event, code };
      });
      createObject(project, tx, name, {
        persistent: definition.get(['persistent']) === true,
        events,
        folder: BRIDGE_FOLDER,
      });
      created.push(name);
      continue;
    }

    throw new ProjectError(`Bridge manifest names an unsupported resource kind: ${resource.kind}`);
  }

  return created;
}

/** Remove the bridge, leaving the project as it was before injection. */
export function ejectBridge(project: GmProject, tx: Transaction): string[] {
  const manifest = loadManifest();
  const removed: string[] = [];

  // Objects before scripts: an object's events reference the scripts, and
  // deleting a referenced resource is refused.
  const order = [...manifest.inject].sort((a, b) => {
    const kindOf = (name: string): number => (project.find(name, tx)?.kind === 'objects' ? 0 : 1);
    return kindOf(a) - kindOf(b);
  });

  for (const name of order) {
    if (!project.has(name, tx)) continue;
    deleteResource(project, tx, name, { force: true });
    removed.push(name);
  }
  removeFolder(project, tx, BRIDGE_FOLDER);
  return removed;
}

/** Drop a folder entry from the `.yyp`, if nothing still lives in it. */
function removeFolder(project: GmProject, tx: Transaction, folder: string): void {
  const path = `folders/${folder}.yy`;
  const yyp = project.yyp(tx);
  const folders = yyp.get(['Folders']) as { folderPath: string }[];
  const at = folders.findIndex((entry) => entry.folderPath === path);
  if (at === -1) return;

  const stillUsed = project
    .resources(tx)
    .some((resource) => project.readDoc(resource.path, tx).get(['parent', 'path']) === path);
  if (stillUsed) return;

  yyp.remove(['Folders', at]);
  tx.writeDoc(project.yypPath, yyp);
}
