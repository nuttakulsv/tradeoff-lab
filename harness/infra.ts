import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

export const LAB = join(process.cwd(), '.lab');
const NATS_VERSION = 'v2.15.0';
export const PG_PORT = 54329;
export const NATS_PORT = 14222;
export const NATS_MONITOR_PORT = 18222;
export const PROVIDER_PORT = 4010;

export interface Postgres {
  url(database: string): string;
  recreate(database: string): Promise<void>;
  query<T extends pg.QueryResultRow = any>(
    database: string,
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  stop(): Promise<void>;
}

/** A real PostgreSQL server from the embedded-postgres package. No Docker needed. */
export async function startPostgres({
  port = PG_PORT,
  dir = join(LAB, 'pg'),
} = {}): Promise<Postgres> {
  rmSync(dir, { recursive: true, force: true });
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'lab',
    password: 'lab',
    port,
    persistent: false,
    postgresFlags: ['-c', 'max_connections=300'],
    onLog: () => {},
  });
  await server.initialise();
  await server.start();

  const url = (database: string) => `postgres://lab:lab@127.0.0.1:${port}/${database}`;
  const pools = new Map<string, pg.Pool>();
  const pool = (database: string) => {
    if (!pools.has(database)) {
      const p = new pg.Pool({ connectionString: url(database), max: 4 });
      p.on('error', () => {});
      pools.set(database, p);
    }
    return pools.get(database)!;
  };

  return {
    url,
    async recreate(database) {
      await pools.get(database)?.end();
      pools.delete(database);
      await pool('postgres').query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await pool('postgres').query(`CREATE DATABASE "${database}"`);
    },
    async query(database, sql, params) {
      return (await pool(database).query(sql, params)).rows;
    },
    async stop() {
      for (const p of pools.values()) await p.end();
      await server.stop();
    },
  };
}

async function natsBinary(): Promise<string> {
  const os = platform() === 'win32' ? 'windows' : platform();
  const cpu = arch() === 'x64' ? 'amd64' : arch();
  const name = `nats-server-${NATS_VERSION}-${os}-${cpu}`;
  const bin = join(LAB, 'bin', name, 'nats-server');
  if (existsSync(bin)) return bin;
  mkdirSync(join(LAB, 'bin'), { recursive: true });
  const url = `https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}/${name}.tar.gz`;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not download nats-server: HTTP ${res.status}`);
  const archive = join(LAB, 'bin', `${name}.tar.gz`);
  await writeFile(archive, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xzf', archive, '-C', join(LAB, 'bin')]);
  return bin;
}

export interface Proc {
  name: string;
  child: ChildProcess;
  exited: Promise<void>;
  stop(signal?: NodeJS.Signals): Promise<void>;
}

export function startProcess(
  name: string,
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Proc {
  mkdirSync(join(LAB, 'logs'), { recursive: true });
  const log = createWriteStream(join(LAB, 'logs', `${name}.log`), { flags: 'a' });
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return {
    name,
    child,
    exited,
    async stop(signal = 'SIGTERM') {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
      const timeout = sleep(10_000).then(() => child.kill('SIGKILL'));
      await Promise.race([exited, timeout]);
      await exited;
    },
  };
}

export async function startNats(): Promise<Proc> {
  const dir = join(LAB, 'nats');
  rmSync(dir, { recursive: true, force: true });
  const proc = startProcess('nats', await natsBinary(), [
    '-js',
    '-sd',
    dir,
    '-p',
    String(NATS_PORT),
    '-m',
    String(NATS_MONITOR_PORT),
  ]);
  await waitHealthy(`http://127.0.0.1:${NATS_MONITOR_PORT}/healthz`, 15_000);
  return proc;
}

export async function waitHealthy(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await res.body?.cancel();
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(50);
  }
  throw new Error(`${url} did not become healthy within ${timeoutMs} ms`);
}

/** Resident memory in MB, summed over the given processes. */
export function rssMb(procs: Proc[]): number {
  const pids = procs.map((p) => p.child.pid).filter((pid): pid is number => !!pid && pid > 0);
  if (!pids.length) return 0;
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')], { encoding: 'utf8' });
    return out.split('\n').reduce((sum, line) => sum + (Number(line.trim()) || 0), 0) / 1024;
  } catch {
    return 0;
  }
}
