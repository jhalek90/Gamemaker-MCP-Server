/**
 * Client for the in-game bridge.
 *
 * Newline-delimited JSON over TCP, with the game acting as server. Requests
 * carry an id and replies quote it, so several can be in flight without
 * ordering assumptions.
 */

import { connect, type Socket } from 'node:net';

export const BRIDGE_PORT = 5959;
export const BRIDGE_PROTOCOL = 1;

export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

export interface BridgeHello {
  event: 'hello';
  protocol: number;
  room: string;
}

export interface ConnectOptions {
  host?: string;
  port?: number;
  /** How long to keep retrying the initial connection. */
  connectTimeoutMs?: number;
  /** How long to wait for any single reply. */
  requestTimeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class BridgeClient {
  private readonly pending = new Map<number, Pending>();
  private buffered = '';
  private nextId = 1;
  private closed = false;

  private constructor(
    private readonly socket: Socket,
    readonly hello: BridgeHello,
    private readonly requestTimeoutMs: number,
  ) {}

  /**
   * Connect to a running game, retrying until the timeout.
   *
   * Retrying matters: the socket only exists once the bridge object's Create
   * event has run, which is some way into startup.
   */
  static async connect(options: ConnectOptions = {}): Promise<BridgeClient> {
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? BRIDGE_PORT;
    const deadline = Date.now() + (options.connectTimeoutMs ?? 30000);

    const socket = await new Promise<Socket>((resolve, reject) => {
      const attempt = (): void => {
        const candidate = connect({ host, port });
        candidate.once('connect', () => resolve(candidate));
        candidate.once('error', (error) => {
          candidate.destroy();
          if (Date.now() >= deadline) {
            reject(new BridgeError(`Could not reach the bridge at ${host}:${port}: ${error.message}`));
          } else {
            setTimeout(attempt, 250);
          }
        });
      };
      attempt();
    });
    socket.setNoDelay(true);

    // The bridge announces itself on connect; the greeting carries the
    // protocol version, so a stale injected copy is caught immediately.
    const hello = await new Promise<BridgeHello>((resolve, reject) => {
      let greeting = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new BridgeError('Connected, but the bridge sent no greeting'));
      }, 10000);
      const onData = (chunk: Buffer): void => {
        greeting += chunk.toString();
        const at = greeting.indexOf('\n');
        if (at === -1) return;
        clearTimeout(timer);
        socket.off('data', onData);
        try {
          const parsed = JSON.parse(greeting.slice(0, at)) as BridgeHello;
          // Anything left over belongs to the next reader.
          const rest = greeting.slice(at + 1);
          if (rest) socket.unshift(Buffer.from(rest));
          resolve(parsed);
        } catch (error) {
          reject(new BridgeError(`Unreadable greeting: ${(error as Error).message}`));
        }
      };
      socket.on('data', onData);
    });

    if (hello.protocol !== BRIDGE_PROTOCOL) {
      socket.destroy();
      throw new BridgeError(
        `Bridge speaks protocol ${hello.protocol}, this server speaks ${BRIDGE_PROTOCOL}. ` +
          'Re-inject the bridge to update it.',
      );
    }

    const client = new BridgeClient(socket, hello, options.requestTimeoutMs ?? 15000);
    socket.on('data', (chunk) => client.absorb(chunk));
    socket.on('close', () => client.failAll(new BridgeError('The game closed the connection')));
    socket.on('error', (error) => client.failAll(new BridgeError(error.message)));
    return client;
  }

  private absorb(chunk: Buffer): void {
    this.buffered += chunk.toString();
    for (;;) {
      const at = this.buffered.indexOf('\n');
      if (at === -1) break;
      const frame = this.buffered.slice(0, at);
      this.buffered = this.buffered.slice(at + 1);
      if (!frame.trim()) continue;

      let message: { id?: number; ok?: boolean; result?: unknown; error?: string };
      try {
        message = JSON.parse(frame);
      } catch {
        continue; // an unreadable frame is not worth tearing the session down
      }
      if (typeof message.id !== 'number') continue; // an unsolicited event
      const waiting = this.pending.get(message.id);
      if (!waiting) continue;
      this.pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.ok) waiting.resolve(message.result);
      else waiting.reject(new BridgeError(message.error ?? 'the game reported an error'));
    }
  }

  private failAll(error: Error): void {
    this.closed = true;
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Send a command and wait for its reply. Rejects if the game reports failure. */
  request(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new BridgeError('The bridge connection is closed'));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(`The game did not answer '${command}' in time`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ id, cmd: command, args })}\n`);
    });
  }

  close(): void {
    this.closed = true;
    this.failAll(new BridgeError('The bridge connection was closed'));
    this.socket.end();
    this.socket.destroy();
  }
}
