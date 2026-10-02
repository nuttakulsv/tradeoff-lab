import { performance } from 'node:perf_hooks';
import {
  PROVIDER_PORT,
  rssMb,
  startNats,
  startPostgres,
  startProcess,
  waitHealthy,
  type Postgres,
  type Proc,
} from './infra.js';
import { variantSpec, type ServiceSpec, type VariantName, type VariantSpec } from './variants.js';

export const providerUrl = `http://127.0.0.1:${PROVIDER_PORT}`;

export interface Infra {
  pg: Postgres;
  nats?: Proc;
  provider: Proc;
  stop(): Promise<void>;
}

export async function startInfra(withBroker: boolean): Promise<Infra> {
  const pg = await startPostgres();
  const nats = withBroker ? await startNats() : undefined;
  const provider = startProcess(
    'payment-provider',
    process.execPath,
    ['dist/payment-provider/main.js'],
    {
      PORT: String(PROVIDER_PORT),
    },
  );
  await waitHealthy(`${providerUrl}/health`);
  return {
    pg,
    nats,
    provider,
    async stop() {
      await provider.stop();
      await nats?.stop();
      await pg.stop();
    },
  };
}

export async function configureProvider(config: Record<string, unknown>, reset = false) {
  const res = await fetch(`${providerUrl}/admin/${reset ? 'reset' : 'config'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`provider config failed: ${res.status}`);
}

export interface Running {
  spec: VariantSpec;
  procs: Map<string, Proc>;
  coldStartMs: number;
  appRssMb(): number;
  brokerRssMb(): number;
  kill(service: string): Promise<void>;
  restart(service: string): Promise<number>;
  stop(): Promise<void>;
}

function spawnService(svc: ServiceSpec) {
  return startProcess(svc.name, process.execPath, [svc.script], {
    PORT: String(svc.port),
    ...svc.env,
  });
}

/** Fresh databases, then every process of the variant, timed until all report healthy. */
export async function startVariant(
  infra: Infra,
  name: VariantName,
  env: Record<string, string> = {},
): Promise<Running> {
  const spec = variantSpec(name, infra.pg.url, env);
  for (const db of new Set(Object.values(spec.databases))) await infra.pg.recreate(db);

  const t0 = performance.now();
  const procs = new Map(spec.services.map((svc) => [svc.name, spawnService(svc)]));
  await Promise.all(
    spec.services.map((svc) => waitHealthy(`http://127.0.0.1:${svc.port}/health`, 60_000)),
  );
  const coldStartMs = performance.now() - t0;

  const byName = (service: string) => spec.services.find((s) => s.name === service)!;
  return {
    spec,
    procs,
    coldStartMs,
    appRssMb: () => rssMb([...procs.values()]),
    brokerRssMb: () => (infra.nats ? rssMb([infra.nats]) : 0),
    async kill(service) {
      await procs.get(service)!.stop('SIGKILL');
    },
    async restart(service) {
      const start = performance.now();
      const svc = byName(service);
      procs.set(service, spawnService(svc));
      await waitHealthy(`http://127.0.0.1:${svc.port}/health`, 60_000);
      return performance.now() - start;
    },
    async stop() {
      // Gateway first so nothing new comes in, then the rest.
      for (const svc of [...spec.services].reverse()) await procs.get(svc.name)!.stop();
    },
  };
}
