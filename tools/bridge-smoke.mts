/**
 * End-to-end check of the bridge: launch the game, connect over TCP, run
 * every command, and confirm a screenshot lands on disk.
 *
 * Usage: npx tsx tools/bridge-smoke.mts
 */
import { existsSync, readdirSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { GmProject } from '../src/project/index.js';
import { IgorRunner } from '../src/build/index.js';

const project = GmProject.open('D:/projects/GML_MCP/bridge/mcp_bridge');
const runner = IgorRunner.create(project);

console.log('launching game...');
const game = await runner.run();

try {
  const line = await game.waitFor(/\[gmlmcp\][^\n]*/, 120000);
  console.log('game says:', line.trim());

  const socket: Socket = await new Promise((resolve, reject) => {
    const attempt = (tries: number): void => {
      const s = connect({ host: '127.0.0.1', port: 5959 });
      s.once('connect', () => resolve(s));
      s.once('error', (e) => {
        if (tries <= 0) return reject(e);
        setTimeout(() => attempt(tries - 1), 300);
      });
    };
    attempt(20);
  });
  console.log('connected');

  let buffered = '';
  const inbox: any[] = [];
  socket.on('data', (chunk) => {
    buffered += chunk.toString();
    let at: number;
    while ((at = buffered.indexOf('\n')) >= 0) {
      const frame = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      if (frame.trim()) inbox.push(JSON.parse(frame));
    }
  });

  const take = async (predicate: (m: any) => boolean, label: string): Promise<any> => {
    for (let i = 0; i < 200; i++) {
      const at = inbox.findIndex(predicate);
      if (at !== -1) return inbox.splice(at, 1)[0];
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  const hello = await take((m) => m.event === 'hello', 'hello');
  console.log('hello:', JSON.stringify(hello));

  let nextId = 1;
  const call = async (cmd: string, args: Record<string, unknown> = {}): Promise<any> => {
    const id = nextId++;
    socket.write(JSON.stringify({ id, cmd, args }) + '\n');
    return take((m) => m.id === id, `${cmd} reply`);
  };

  const ping = await call('ping');
  console.log('ping:', JSON.stringify(ping));

  console.log('set_var:', JSON.stringify(await call('set_var', { scope: 'global', name: 'agent_score', value: 42 })));
  console.log('get_var:', JSON.stringify(await call('get_var', { scope: 'global', name: 'agent_score' })));
  console.log('tunables:', JSON.stringify(await call('tunables', { set: { player_speed: 3.5, gravity: 0.4 } })));
  console.log('instances:', JSON.stringify(await call('instances', {})));
  console.log('bad cmd:', JSON.stringify(await call('no_such_command')));

  const shot = await call('screenshot', { name: 'agent_view.png' });
  console.log('screenshot:', JSON.stringify(shot));
  if (shot.ok && shot.result?.directory) {
    const dir = shot.result.directory;
    console.log('  exists on disk:', existsSync(dir + shot.result.file));
    console.log('  dir listing:', readdirSync(dir).slice(0, 6).join(', '));
  }

  socket.end();
} catch (error) {
  console.log('FAILED:', (error as Error).message);
  console.log('--- game output tail ---');
  console.log(game.log().split('\n').slice(-25).join('\n'));
} finally {
  game.stop();
}
