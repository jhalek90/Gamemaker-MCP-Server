/**
 * The MCP surface: what an agent actually sees.
 *
 * Two design choices shape the tool list.
 *
 * The GML reference is exposed through search and lookup rather than loaded
 * into context. The whole spec is ~198,000 tokens even distilled down to
 * signatures and descriptions; a single lookup is 80-200. Preloading would
 * buy one saved round-trip at a thousand times the cost, and would crowd out
 * the project's own code — which is what the agent actually needs to reason
 * about.
 *
 * Every mutation is one transaction with a named restore point, so `gml_undo`
 * steps back through whole operations rather than individual file writes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  addEvent,
  checkGml,
  createFolder,
  createObject,
  createScript,
  deleteResource,
  eventFileName,
  GmProject,
  listEvents,
  ProjectSymbols,
  removeEvent,
  renameResource,
  addRoomInstance,
  setSpriteProperties,
  type Diagnostic,
  type GmEvent,
} from '../project/index.js';
import { formatBuildDiagnostics, IgorRunner, type RunHandle } from '../build/index.js';
import { BridgeClient, bridgeStatus, ejectBridge, injectBridge } from '../bridge/index.js';
import { GmlSpec, requireRuntime, signatureOf, summarize, type GmlEntry } from '../spec/index.js';

const EventSchema = z.object({
  type: z.number().int().describe('eventType: 0 Create, 2 Alarm, 3 Step, 4 Collision, 8 Draw, 9 KeyPress'),
  number: z.number().int().default(0).describe('eventNum: Step 0/1/2, Draw 0/64/72/73, alarm index, key code'),
  collisionWith: z.string().optional().describe('Other object name, required for collision events'),
});

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });

/** Render a spec entry in full, for `gml_lookup`. */
function describeEntry(entry: GmlEntry): string {
  const lines: string[] = [summarize(entry)];
  if (entry.kind === 'function') {
    if (entry.deprecated) lines.push('DEPRECATED');
    if (entry.description) lines.push('', entry.description);
    if (entry.parameters.length) {
      lines.push('');
      for (const parameter of entry.parameters) {
        lines.push(
          `  ${parameter.name}${parameter.optional ? ' (optional)' : ''}: ${parameter.type}` +
            (parameter.description ? ` — ${parameter.description}` : ''),
        );
      }
    }
  } else if ('description' in entry && entry.description) {
    lines.push('', entry.description);
  } else if (entry.kind === 'structure') {
    for (const field of entry.fields) lines.push(`  ${field.name}: ${field.type} — ${field.description}`);
  } else if (entry.kind === 'enum') {
    for (const member of entry.members) lines.push(`  ${member.name} = ${member.value}`);
  }
  return lines.join('\n');
}

function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return 'No unknown identifiers.';
  return diagnostics
    .map((d) => {
      const hint = d.suggestions.length ? `  (did you mean ${d.suggestions.join(', ')}?)` : '';
      return `${d.file}:${d.line}:${d.column}  ${d.message}${hint}`;
    })
    .join('\n');
}

export interface ServerOptions {
  /** GameMaker project root. */
  projectRoot: string;
}

export function createServer({ projectRoot }: ServerOptions): McpServer {
  const server = new McpServer({ name: 'gml-mcp', version: '0.1.0' });

  // Loaded lazily so the server starts even without a runtime installed —
  // project tools still work, only the GML reference is unavailable.
  let cachedSpec: GmlSpec | undefined;
  const spec = (): GmlSpec => {
    if (!cachedSpec) cachedSpec = GmlSpec.load(requireRuntime().specPath);
    return cachedSpec;
  };
  const project = (): GmProject => GmProject.open(projectRoot);

  // The running game and its bridge connection outlive individual tool calls.
  let game: RunHandle | undefined;
  let live: BridgeClient | undefined;

  const requireLive = (): BridgeClient => {
    if (!live?.isOpen) {
      throw new Error('No game is running. Use gml_run first.');
    }
    return live;
  };

  const shutdown = (): void => {
    live?.close();
    live = undefined;
    game?.stop();
    game = undefined;
  };
  process.once('exit', shutdown);

  // -- GML reference ------------------------------------------------------

  server.registerTool(
    'gml_search',
    {
      description:
        'Search the GML standard library by name or description. Use this before writing GML ' +
        'that calls an unfamiliar function, and to discover what exists (e.g. "screenshot", ' +
        '"buffer write", "tcp server").',
      inputSchema: {
        query: z.string().describe('Words to match against function names and descriptions'),
        limit: z.number().int().min(1).max(50).default(15),
      },
    },
    async ({ query, limit }) => {
      const results = spec().search(query, limit);
      if (!results.length) return text(`No GML entries match ${JSON.stringify(query)}.`);
      return text(results.map((r) => summarize(r.entry)).join('\n'));
    },
  );

  server.registerTool(
    'gml_lookup',
    {
      description:
        'Full signature, parameter types and documentation for one GML function, variable or ' +
        'constant. Returns near matches if the exact name does not exist.',
      inputSchema: { name: z.string().describe('Exact GML identifier, e.g. instance_create_layer') },
    },
    async ({ name }) => {
      const entry = spec().lookup(name);
      if (entry) return text(describeEntry(entry));
      const suggestions = spec().suggest(name, 5);
      return text(
        `'${name}' is not part of GML.` +
          (suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''),
      );
    },
  );

  server.registerTool(
    'gml_check',
    {
      description:
        'Check GML for calls to functions that exist in neither the runtime nor this project. ' +
        'Run this after writing or editing GML — it catches invented functions that look ' +
        'plausible. Pass code to check a draft, or omit it to check the whole project.',
      inputSchema: {
        code: z.string().optional().describe('GML source to check; omit to check every file'),
        file: z.string().optional().describe('Project-relative path, used for reporting'),
      },
    },
    async ({ code, file }) => {
      const current = project();
      const symbols = ProjectSymbols.scan(current);
      if (code !== undefined) {
        return text(formatDiagnostics(checkGml(code, file ?? '<draft>', spec(), symbols)));
      }
      const { checkProject } = await import('../project/symbols.js');
      const diagnostics = checkProject(current, spec(), symbols);
      return text(formatDiagnostics(diagnostics));
    },
  );

  // -- project ------------------------------------------------------------

  server.registerTool(
    'gml_project_info',
    {
      description: 'Project name, resource counts, and the GameMaker runtime in use.',
      inputSchema: {},
    },
    async () => {
      const current = project();
      const counts = new Map<string, number>();
      for (const resource of current.resources()) {
        counts.set(resource.kind, (counts.get(resource.kind) ?? 0) + 1);
      }
      let runtime = 'no runtime found';
      try {
        const found = requireRuntime();
        runtime = `${found.version}${found.igorPath ? '' : ' (Igor not found)'}`;
      } catch {
        /* reference tools will report this themselves */
      }
      return text(
        [
          `project: ${current.name}`,
          `root: ${current.root}`,
          `runtime: ${runtime}`,
          `resources: ${[...counts].map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`,
          `folders: ${current.folders().length}`,
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'gml_list_resources',
    {
      description: 'List project resources, optionally filtered by kind.',
      inputSchema: {
        kind: z.string().optional().describe('e.g. objects, sprites, scripts, rooms'),
        contains: z.string().optional().describe('Substring filter on the name'),
      },
    },
    async ({ kind, contains }) => {
      const resources = project()
        .resources()
        .filter((r) => (!kind || r.kind === kind) && (!contains || r.name.includes(contains)));
      if (!resources.length) return text('No matching resources.');
      return text(resources.map((r) => `${r.name}  (${r.path})`).join('\n'));
    },
  );

  server.registerTool(
    'gml_read',
    {
      description: 'Read a file from the project, e.g. objects/objPlayer/Step_0.gml.',
      inputSchema: { path: z.string().describe('Project-relative path') },
    },
    async ({ path }) => {
      const body = project().readText(path);
      return text(body === undefined ? `No such file: ${path}` : body);
    },
  );

  server.registerTool(
    'gml_list_events',
    {
      description: 'Events an object defines, with the file each lives in.',
      inputSchema: { object: z.string() },
    },
    async ({ object }) => {
      const events = listEvents(project(), object);
      if (!events.length) return text(`${object} defines no events.`);
      return text(events.map((event) => eventFileName(event)).join('\n'));
    },
  );

  // -- mutations ----------------------------------------------------------

  server.registerTool(
    'gml_create_object',
    {
      description:
        'Create an object, optionally with a sprite, parent, folder and event code. Registers ' +
        'it in the .yyp as one atomic change that gml_undo can reverse.',
      inputSchema: {
        name: z.string().describe('Resource name, e.g. objPlayer'),
        sprite: z.string().optional(),
        parentObject: z.string().optional(),
        folder: z.string().optional().describe('Asset browser folder, e.g. Actors/Enemies'),
        persistent: z.boolean().optional(),
        events: z
          .array(z.object({ event: EventSchema, code: z.string() }))
          .optional()
          .describe('Event code to create alongside the object'),
      },
    },
    async ({ name, sprite, parentObject, folder, persistent, events }) => {
      const current = project();
      const ref = current.transact(`create object ${name}`, (tx) =>
        createObject(current, tx, name, {
          sprite,
          parentObject,
          folder,
          persistent,
          events: events?.map((e) => ({ event: e.event as GmEvent, code: e.code })),
        }),
      );
      return text(`Created ${ref.name} at ${ref.path}`);
    },
  );

  server.registerTool(
    'gml_create_script',
    {
      description: 'Create a script resource containing GML.',
      inputSchema: {
        name: z.string(),
        code: z.string(),
        folder: z.string().optional(),
      },
    },
    async ({ name, code, folder }) => {
      const current = project();
      const ref = current.transact(`create script ${name}`, (tx) =>
        createScript(current, tx, name, code, { folder }),
      );
      return text(`Created ${ref.name} at ${ref.path}`);
    },
  );

  server.registerTool(
    'gml_create_folder',
    {
      description: 'Create an asset browser folder, and any parents it needs.',
      inputSchema: { folder: z.string().describe('e.g. Actors/Enemies') },
    },
    async ({ folder }) => {
      const current = project();
      const path = current.transact(`create folder ${folder}`, (tx) =>
        createFolder(current, tx, folder),
      );
      return text(`Created ${path}`);
    },
  );

  server.registerTool(
    'gml_set_event',
    {
      description:
        'Set the code for an object event, adding the event if it does not exist. This is the ' +
        'main way to write gameplay logic.',
      inputSchema: { object: z.string(), event: EventSchema, code: z.string() },
    },
    async ({ object, event, code }) => {
      const current = project();
      const target = event as GmEvent;
      current.transact(`set ${object} ${eventFileName(target)}`, (tx) =>
        addEvent(current, tx, object, target, code),
      );
      const diagnostics = checkGml(
        code,
        `objects/${object}/${eventFileName(target)}`,
        spec(),
        ProjectSymbols.scan(current),
      );
      return text(
        `Wrote objects/${object}/${eventFileName(target)}\n${formatDiagnostics(diagnostics)}`,
      );
    },
  );

  server.registerTool(
    'gml_remove_event',
    {
      description: 'Remove an event from an object, deleting its file.',
      inputSchema: { object: z.string(), event: EventSchema },
    },
    async ({ object, event }) => {
      const current = project();
      const target = event as GmEvent;
      current.transact(`remove ${object} ${eventFileName(target)}`, (tx) =>
        removeEvent(current, tx, object, target),
      );
      return text(`Removed ${eventFileName(target)} from ${object}`);
    },
  );

  server.registerTool(
    'gml_set_sprite_properties',
    {
      description: 'Edit a sprite\'s origin, collision mask and bounding box.',
      inputSchema: {
        name: z.string(),
        origin: z.number().int().optional().describe('0 top-left ... 4 centre, 9 custom'),
        bboxMode: z.number().int().optional().describe('0 automatic, 1 full image, 2 manual'),
        collisionKind: z.number().int().optional().describe('0 precise, 1 rectangle, 2 ellipse, 3 diamond'),
        bbox: z
          .object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() })
          .optional(),
      },
    },
    async ({ name, ...properties }) => {
      const current = project();
      current.transact(`sprite properties ${name}`, (tx) =>
        setSpriteProperties(current, tx, name, properties),
      );
      return text(`Updated ${name}`);
    },
  );

  server.registerTool(
    'gml_rename_resource',
    {
      description:
        'Rename a resource and rewrite every reference to it — sprite assignments, parents, ' +
        'collision events and room instances included.',
      inputSchema: { from: z.string(), to: z.string() },
    },
    async ({ from, to }) => {
      const current = project();
      const referrers = current.references(current.find(from) ?? { name: from, path: '', kind: 'objects' });
      const ref = current.transact(`rename ${from} to ${to}`, (tx) =>
        renameResource(current, tx, from, to),
      );
      return text(`Renamed ${from} to ${ref.name}, updating ${referrers.length} reference(s)`);
    },
  );

  server.registerTool(
    'gml_delete_resource',
    {
      description:
        'Delete a resource and its files. Refuses while other resources still reference it, ' +
        'unless force is set.',
      inputSchema: { name: z.string(), force: z.boolean().default(false) },
    },
    async ({ name, force }) => {
      const current = project();
      current.transact(`delete ${name}`, (tx) => deleteResource(current, tx, name, { force }));
      return text(`Deleted ${name}`);
    },
  );

  server.registerTool(
    'gml_compile',
    {
      description:
        'Compile the project with GameMaker and report any errors, located to file and line. ' +
        'A small project compiles in a few seconds. Run this after a set of edits to confirm ' +
        'the project still builds — it catches syntax and structural errors that gml_check ' +
        'cannot, while gml_check catches calls to functions that do not exist, which the ' +
        'compiler resolves at runtime and therefore does not report.',
      inputSchema: {
        config: z.string().optional().describe('Project config to build; defaults to Default'),
        target: z.enum(['VM', 'YYC']).default('VM').describe('VM is much faster and needs no Visual Studio'),
        ignoreCache: z.boolean().default(false).describe('Discard the build cache; slower but rules out stale results'),
      },
    },
    async ({ config, target, ignoreCache }) => {
      const runner = IgorRunner.create(project());
      const result = await runner.compile({ config, target, ignoreCache });
      const seconds = (result.durationMs / 1000).toFixed(1);
      if (result.timedOut) {
        return text(`Build timed out after ${seconds}s.\n${formatBuildDiagnostics(result.diagnostics)}`);
      }
      const heading = result.ok
        ? `Build succeeded in ${seconds}s (${target}).`
        : `Build FAILED in ${seconds}s (exit ${result.exitCode}).`;
      return text(`${heading}\n${formatBuildDiagnostics(result.diagnostics)}`);
    },
  );

  // -- live game ----------------------------------------------------------

  server.registerTool(
    'gml_bridge',
    {
      description:
        'Install, remove or inspect the in-game bridge — a small set of GML resources ' +
        '(obj_gmlmcp_bridge and two scripts) that let this server talk to the running game. ' +
        'Ejecting restores the project to exactly the bytes it had before.',
      inputSchema: {
        action: z.enum(['status', 'inject', 'eject']).default('status'),
      },
    },
    async ({ action }) => {
      const current = project();
      if (action === 'status') {
        const status = bridgeStatus(current);
        return text(
          status.installed
            ? `Bridge installed (protocol ${status.protocol}): ${status.present.join(', ')}`
            : `Bridge not installed. Missing: ${status.missing.join(', ')}`,
        );
      }
      if (action === 'inject') {
        const created = current.transact('inject bridge', (tx) => injectBridge(current, tx));
        return text(
          `Injected ${created.join(', ')}.\n` +
            'Place obj_gmlmcp_bridge in a room (gml_add_room_instance) so it starts with the game.',
        );
      }
      const removed = current.transact('eject bridge', (tx) => ejectBridge(current, tx));
      return text(removed.length ? `Removed ${removed.join(', ')}.` : 'Bridge was not installed.');
    },
  );

  server.registerTool(
    'gml_add_room_instance',
    {
      description: 'Place an instance of an object into a room.',
      inputSchema: {
        room: z.string(),
        object: z.string(),
        x: z.number().default(0),
        y: z.number().default(0),
        layer: z.string().optional().describe('Defaults to the room\'s first instance layer'),
      },
    },
    async ({ room, object, x, y, layer }) => {
      const current = project();
      const name = current.transact(`place ${object} in ${room}`, (tx) =>
        addRoomInstance(current, tx, room, object, { x, y, layer }),
      );
      return text(`Placed ${object} in ${room} at ${x},${y} as ${name}`);
    },
  );

  server.registerTool(
    'gml_run',
    {
      description:
        'Build and launch the game, then connect to its bridge. Leaves the game running so ' +
        'the other live tools can inspect it. Requires the bridge to be injected and placed ' +
        'in the starting room.',
      inputSchema: {
        config: z.string().optional(),
        target: z.enum(['VM', 'YYC']).default('VM'),
      },
    },
    async ({ config, target }) => {
      const current = project();
      if (!bridgeStatus(current).installed) {
        return text('The bridge is not injected. Run gml_bridge with action "inject" first.');
      }
      shutdown();

      const runner = IgorRunner.create(current);
      game = await runner.run({ config, target });
      try {
        await game.waitFor(/\[gmlmcp\][^\n]*/, 180000);
        live = await BridgeClient.connect();
      } catch (error) {
        const tail = game.log().split('\n').slice(-20).join('\n');
        shutdown();
        return text(`Game did not come up: ${(error as Error).message}\n\n${tail}`);
      }
      const state = await live.request('ping');
      return text(`Game running. Bridge connected.\n${JSON.stringify(state, null, 2)}`);
    },
  );

  server.registerTool(
    'gml_stop',
    { description: 'Stop the running game and close the bridge connection.', inputSchema: {} },
    async () => {
      if (!game) return text('No game is running.');
      shutdown();
      return text('Stopped.');
    },
  );

  server.registerTool(
    'gml_screenshot',
    {
      description:
        'Capture what the running game is showing right now, and return the image path so it ' +
        'can be read. Taken at the end of a frame, so the picture is complete.',
      inputSchema: { name: z.string().optional().describe('File name; defaults to a timestamp') },
    },
    async ({ name }) => {
      const result = (await requireLive().request('screenshot', name ? { name } : {})) as {
        file: string;
        directory: string;
      };
      return text(`Saved ${result.directory}${result.file}`);
    },
  );

  server.registerTool(
    'gml_live_state',
    {
      description:
        'What the running game is doing: current room, frame rate, and the instances that exist.',
      inputSchema: {
        object: z.string().optional().describe('Limit to instances of this object'),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ object, limit }) => {
      const client = requireLive();
      const ping = await client.request('ping');
      const instances = await client.request('instances', object ? { object, limit } : { limit });
      return text(JSON.stringify({ ...(ping as object), ...(instances as object) }, null, 2));
    },
  );

  server.registerTool(
    'gml_live_var',
    {
      description:
        'Read or write a variable in the running game. Omit value to read. Scope is "global" ' +
        'or an object name or instance id.',
      inputSchema: {
        name: z.string(),
        scope: z.string().default('global'),
        value: z.any().optional().describe('Omit to read; provide to write'),
      },
    },
    async ({ name, scope, value }) => {
      const client = requireLive();
      const result =
        value === undefined
          ? await client.request('get_var', { scope, name })
          : await client.request('set_var', { scope, name, value });
      return text(JSON.stringify(result));
    },
  );

  server.registerTool(
    'gml_live_call',
    {
      description:
        'Call a script function in the running game. GML cannot evaluate new code at runtime, ' +
        'so only functions the project already defines can be called.',
      inputSchema: {
        function: z.string().describe('Script function name'),
        args: z.array(z.any()).default([]),
      },
    },
    async ({ function: fn, args }) => {
      const result = await requireLive().request('call', { function: fn, args });
      return text(JSON.stringify(result));
    },
  );

  server.registerTool(
    'gml_tunables',
    {
      description:
        'Read or adjust the live tunables the game has registered — speeds, gravity, spawn ' +
        'rates. Changes take effect immediately with no recompile, which makes an ' +
        'adjust-then-screenshot loop practical for tuning game feel.',
      inputSchema: {
        set: z.record(z.string(), z.any()).optional().describe('Values to change; omit to read'),
      },
    },
    async ({ set }) => {
      const result = await requireLive().request('tunables', set ? { set } : {});
      return text(JSON.stringify(result, null, 2));
    },
  );

  // -- history ------------------------------------------------------------

  server.registerTool(
    'gml_undo',
    {
      description:
        'Undo the most recent change made through this server. Repeatable — each call steps ' +
        'one operation further back.',
      inputSchema: {},
    },
    async () => {
      const undone = project().workspace.undo();
      if (!undone) return text('Nothing to undo.');
      return text(`Undid "${undone.label}" (${undone.paths.length} file(s) restored)`);
    },
  );

  server.registerTool(
    'gml_history',
    {
      description: 'Recent changes made through this server, newest first.',
      inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
    },
    async ({ limit }) => {
      const snapshots = project().workspace.history(limit);
      if (!snapshots.length) return text('No changes recorded.');
      return text(
        snapshots
          .map((s) => `${s.time.toISOString()}  ${s.label}  (${s.paths.length} file(s))`)
          .join('\n'),
      );
    },
  );

  return server;
}

export async function runStdioServer(options: ServerOptions): Promise<void> {
  const server = createServer(options);
  await server.connect(new StdioServerTransport());
}
