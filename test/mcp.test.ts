/**
 * Drive the server through the real MCP protocol, over an in-memory
 * transport, against a real project copy. This is the only test that
 * exercises what an agent will actually touch.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/mcp/index.js';
import { findRuntimes } from '../src/spec/index.js';

const hasRuntime = findRuntimes().length > 0;

let root: string;
let client: Client;

const YYP = [
  '{',
  '  "$GMProject":"v1",',
  '  "%Name":"TestGame",',
  '  "Folders":[],',
  '  "IncludedFiles":[],',
  '  "name":"TestGame",',
  '  "resources":[',
  '    {"id":{"name":"sprPlayer","path":"sprites/sprPlayer/sprPlayer.yy",},},',
  '  ],',
  '  "resourceType":"GMProject",',
  '  "resourceVersion":"2.0",',
  '}',
].join('\n');

const SPR = [
  '{',
  '  "$GMSprite":"v2",',
  '  "%Name":"sprPlayer",',
  '  "bboxMode":0,',
  '  "collisionKind":1,',
  '  "name":"sprPlayer",',
  '  "origin":0,',
  '  "resourceType":"GMSprite",',
  '  "resourceVersion":"2.0",',
  '}',
].join('\n');

function seed(path: string, body: string): void {
  const absolute = join(root, path);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, body);
}

/** Call a tool and return its text content. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[];
    isError?: boolean;
  };
  return result.content.map((part) => part.text ?? '').join('\n');
}

beforeEach(async () => {
  // Always the fixture: these assertions are about the server's behaviour and
  // need known resources. Real-project compatibility is integration.test.ts.
  root = mkdtempSync(join(tmpdir(), 'gml-mcp-server-'));
  seed('TestGame.yyp', YYP);
  seed('sprites/sprPlayer/sprPlayer.yy', SPR);

  const server = createServer({ projectRoot: root });
  client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  rmSync(root, { recursive: true, force: true });
});

describe('mcp server', () => {
  it('advertises its tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toContain('gml_search');
    expect(names).toContain('gml_lookup');
    expect(names).toContain('gml_check');
    expect(names).toContain('gml_create_object');
    expect(names).toContain('gml_set_event');
    expect(names).toContain('gml_undo');
    expect(names).toContain('gml_compile');
    for (const tool of tools) expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
  });

  it('reports project info', async () => {
    const info = await call('gml_project_info');
    expect(info).toContain('project:');
    expect(info).toContain('sprites');
  });

  it('lists resources with filters', async () => {
    expect(await call('gml_list_resources', { kind: 'sprites' })).toContain('sprPlayer');
    expect(await call('gml_list_resources', { kind: 'rooms', contains: 'zzz' })).toContain('No matching');
  });
});

describe.skipIf(!hasRuntime)('gml reference tools', () => {
  it('searches by name', async () => {
    const found = await call('gml_search', { query: 'instance_create_layer' });
    expect(found).toContain('instance_create_layer(');
  });

  it('searches by description', async () => {
    expect(await call('gml_search', { query: 'screenshot', limit: 5 })).toContain('screen_save');
  });

  it('looks up full detail', async () => {
    const detail = await call('gml_lookup', { name: 'network_create_server_raw' });
    expect(detail).toContain('network_create_server_raw(');
    expect(detail).toContain('port');
  });

  it('rejects a function that does not exist, with suggestions', async () => {
    const answer = await call('gml_lookup', { name: 'instance_create_layerr' });
    expect(answer).toContain('is not part of GML');
    expect(answer).toContain('instance_create_layer');
  });

  it('checks draft code for invented functions', async () => {
    const clean = await call('gml_check', { code: 'show_debug_message("hi");' });
    expect(clean).toContain('No unknown identifiers');

    const dirty = await call('gml_check', { code: 'network_send_packet_raw(1);' });
    expect(dirty).toContain('Unknown function');
    expect(dirty).toContain('network_send_packet_raw');
  });
});

describe.skipIf(!hasRuntime)('mutations', () => {
  it('creates an object with events and checks the code it wrote', async () => {
    const created = await call('gml_create_object', {
      name: 'objBridge',
      sprite: 'sprPlayer',
      events: [{ event: { type: 0, number: 0 }, code: 'server = network_create_server_raw(1, 5959, 4);' }],
    });
    expect(created).toContain('Created objBridge');
    expect(existsSync(join(root, 'objects/objBridge/Create_0.gml'))).toBe(true);
    expect(await call('gml_list_events', { object: 'objBridge' })).toContain('Create_0');
  });

  it('warns about an invented function when setting event code', async () => {
    await call('gml_create_object', { name: 'objTest' });
    const response = await call('gml_set_event', {
      object: 'objTest',
      event: { type: 3, number: 0 },
      code: 'x += 1;\nmake_believe_function();',
    });
    expect(response).toContain('Wrote objects/objTest/Step_0.gml');
    expect(response).toContain('make_believe_function');
  });

  it('creates a script and reads it back', async () => {
    await call('gml_create_script', { name: 'scr_math', code: 'function half(v) { return v / 2; }' });
    expect(await call('gml_read', { path: 'scripts/scr_math/scr_math.gml' })).toContain('half');
  });

  it('edits sprite properties', async () => {
    await call('gml_set_sprite_properties', { name: 'sprPlayer', origin: 4, collisionKind: 0 });
    expect(await call('gml_read', { path: 'sprites/sprPlayer/sprPlayer.yy' })).toContain('"origin":4');
  });

  it('refuses to delete a referenced resource', async () => {
    await call('gml_create_object', { name: 'objUser', sprite: 'sprPlayer' });
    const result = (await client.callTool({
      name: 'gml_delete_resource',
      arguments: { name: 'sprPlayer' },
    })) as { isError?: boolean; content: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content.map((c) => c.text).join('')).toContain('still referenced');
  });

  it('renames and rewrites references', async () => {
    await call('gml_create_object', { name: 'objUser', sprite: 'sprPlayer' });
    const renamed = await call('gml_rename_resource', { from: 'sprPlayer', to: 'sprHero' });
    expect(renamed).toContain('Renamed sprPlayer to sprHero');
    expect(await call('gml_read', { path: 'objects/objUser/objUser.yy' })).toContain('sprHero');
  });

  it('undoes one operation at a time', async () => {
    await call('gml_create_object', { name: 'objFirst' });
    await call('gml_create_object', { name: 'objSecond' });
    expect(await call('gml_history')).toContain('create object objSecond');

    expect(await call('gml_undo')).toContain('objSecond');
    expect(existsSync(join(root, 'objects/objSecond'))).toBe(false);
    expect(existsSync(join(root, 'objects/objFirst'))).toBe(true);

    expect(await call('gml_undo')).toContain('objFirst');
    expect(existsSync(join(root, 'objects/objFirst'))).toBe(false);
    expect(await call('gml_undo')).toContain('Nothing to undo');
  });

  it('leaves the .yyp valid after a create/undo cycle', async () => {
    const before = readFileSync(join(root, 'TestGame.yyp'), 'utf8');
    await call('gml_create_object', { name: 'objChurn' });
    await call('gml_undo');
    expect(readFileSync(join(root, 'TestGame.yyp'), 'utf8')).toBe(before);
  });
});
