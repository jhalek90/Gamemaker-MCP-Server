/**
 * End-to-end demonstration, driven through the MCP protocol exactly as an
 * agent would: inject the bridge into a real project, place it, compile, run,
 * inspect the live game, and capture a screenshot.
 *
 * Usage: npx tsx tools/live-demo.mts [path/to/project]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/mcp/index.js';

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error('usage: npx tsx tools/live-demo.mts <path to a GameMaker project>');
  process.exit(1);
}
const root = mkdtempSync(join(tmpdir(), 'gml-live-demo-'));
cpSync(SOURCE, root, { recursive: true });
console.log(`working on a copy of ${SOURCE}\n  at ${root}\n`);

const server = createServer({ projectRoot: root });
const client = new Client({ name: 'live-demo', version: '1.0.0' });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(b), client.connect(a)]);

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text?: string }[];
    isError?: boolean;
  };
  const body = result.content.map((part) => part.text ?? '').join('\n');
  console.log(`> ${name}${Object.keys(args).length ? ' ' + JSON.stringify(args) : ''}`);
  console.log(body.split('\n').map((line) => '    ' + line).join('\n'));
  console.log();
  if (result.isError) throw new Error(`${name} failed`);
  return body;
}

try {
  await call('gml_bridge', { action: 'status' });
  await call('gml_bridge', { action: 'inject' });
  await call('gml_add_room_instance', { room: 'Room1', object: 'obj_gmlmcp_bridge', x: 0, y: 0 });
  await call('gml_check');
  await call('gml_compile');
  await call('gml_run');
  await call('gml_live_state', { limit: 5 });
  await call('gml_tunables', { set: { steering: 0.75, top_speed: 12 } });
  await call('gml_live_var', { name: 'demo_marker', value: 'set by an agent' });
  await call('gml_live_var', { name: 'demo_marker' });
  const shot = await call('gml_screenshot', { name: 'live_demo.png' });
  console.log('screenshot at:', shot.replace('Saved ', '').trim());
} catch (error) {
  console.log('FAILED:', (error as Error).message);
} finally {
  await call('gml_stop').catch(() => undefined);
  await client.close();
  // The game process can still hold handles for a moment after being killed.
  for (let attempt = 0; attempt < 10; attempt++) {
    try { rmSync(root, { recursive: true, force: true }); break; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
  }
}
