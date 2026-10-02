import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { checkInvariants, settle, unfinished } from './check.js';
import { runLoad, summarize } from './load.js';
import { randomItems, type Scenario } from './scenarios.js';
import { configureProvider, startVariant, type Infra } from './session.js';
import type { VariantName } from './variants.js';

export const machine = () => ({
  cpu: cpus()[0]?.model ?? 'unknown',
  cores: cpus().length,
  memoryGb: Math.round(totalmem() / 2 ** 30),
  os: `${platform()} ${release()}`,
  node: process.version,
});

export async function runScenario(
  infra: Infra,
  variant: VariantName,
  scenario: Scenario,
  { quick = false } = {},
) {
  const scale = quick ? 0.2 : 1;
  const durationMs = scenario.durationMs * scale;
  console.log(`\n▸ ${variant} / ${scenario.name}: ${scenario.title} (${durationMs / 1000}s)`);

  await configureProvider(scenario.provider, true);
  const running = await startVariant(infra, variant, scenario.env?.(variant) ?? {});
  await sleep(1000);
  const idleRssMb = running.appRssMb();
  let peakRssMb = idleRssMb;
  const sampler = setInterval(() => (peakRssMb = Math.max(peakRssMb, running.appRssMb())), 1000);

  const events: { label: string; atMs: number }[] = [];
  let killAt: number | undefined;
  let restartedAt: number | undefined;
  let recoveryMs: number | null = null;
  const t0 = performance.now();
  const killedAtDate: Date[] = [];

  const timeline = (scenario.timeline ?? []).map(async (step) => {
    await sleep(step.atMs * scale);
    const target = running.spec.crashTarget;
    if (step.action === 'provider') await configureProvider(step.provider ?? {});
    if (step.action === 'kill') {
      killedAtDate.push(new Date());
      await running.kill(target);
      killAt = performance.now() - t0;
    }
    if (step.action === 'restart') {
      await running.restart(target);
      restartedAt = performance.now() - t0;
    }
    events.push({ label: step.label, atMs: Math.round(performance.now() - t0) });
    if (step.action === 'restart') {
      // Recovery: from the restart until every order placed before the crash is finished.
      const since = performance.now();
      while (performance.now() - since < 120_000) {
        if ((await unfinished(infra.pg, running.spec, killedAtDate[0])) === 0) {
          recoveryMs = performance.now() - since;
          break;
        }
        await sleep(200);
      }
    }
  });

  const load = await runLoad({
    baseUrl: running.spec.baseUrl,
    concurrency: scenario.concurrency,
    durationMs,
    items: scenario.items ?? randomItems,
    duplicateRequests: scenario.duplicateRequests,
  });
  await Promise.all(timeline);
  const drainMs = await settle(infra.pg, running.spec);
  clearInterval(sampler);
  const invariants = await checkInvariants(infra.pg, running.spec);
  // Time the server spent on each order, from insert to final status, without client polling.
  const [server] = await infra.pg.query<{ p50: number; p95: number; p99: number }>(
    running.spec.databases.orders,
    `SELECT ${[50, 95, 99]
      .map(
        (p) =>
          `round(percentile_cont(${p / 100}) WITHIN GROUP (ORDER BY ms)::numeric, 1)::float AS p${p}`,
      )
      .join(', ')}
     FROM (SELECT extract(epoch FROM updated_at - created_at) * 1000 AS ms FROM orders.orders
           WHERE status IN ('CONFIRMED', 'REJECTED')) t`,
  );
  const brokerRssMb = running.brokerRssMb();
  await running.stop();

  const { samples } = load;
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300);
  const done = samples.filter((s) => s.e2eMs !== null);
  const errors = samples.length - ok.length;
  const count = (status: string) => done.filter((s) => s.final === status).length;
  const reasons: Record<string, number> = {};
  for (const s of done) if (s.reason) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;

  const seconds = Math.ceil(load.elapsedMs / 1000);
  const series = Array.from({ length: seconds }, () => ({ completed: 0, failed: 0 }));
  for (const s of samples) {
    const at = Math.min(seconds - 1, Math.floor((s.at + (s.e2eMs ?? s.requestMs)) / 1000));
    if (s.e2eMs !== null && s.final === 'CONFIRMED') series[at].completed++;
    else series[at].failed++;
  }

  const result = {
    variant,
    scenario: scenario.name,
    title: scenario.title,
    quick,
    machine: machine(),
    ranAt: new Date().toISOString(),
    concurrency: scenario.concurrency,
    durationMs,
    coldStartMs: Math.round(running.coldStartMs),
    memory: {
      idleRssMb: Math.round(idleRssMb),
      peakRssMb: Math.round(peakRssMb),
      brokerRssMb: Math.round(brokerRssMb),
    },
    requests: samples.length,
    completed: done.length,
    confirmed: count('CONFIRMED'),
    rejected: count('REJECTED'),
    reasons,
    errors,
    errorRate: samples.length ? Math.round((errors / samples.length) * 10_000) / 100 : 0,
    throughput: Math.round((done.length / (load.elapsedMs / 1000)) * 10) / 10,
    confirmedPerSecond: Math.round((count('CONFIRMED') / (load.elapsedMs / 1000)) * 10) / 10,
    requestMs: summarize(ok.map((s) => s.requestMs)),
    e2eMs: summarize(done.map((s) => s.e2eMs!)),
    slowAnswers: done.filter((s) => s.e2eMs! > 1000).length,
    serverMs: server,
    polls: load.polls,
    duplicatesSent: load.duplicatesSent,
    drainMs: drainMs === null ? null : Math.round(drainMs),
    timeline: events,
    series,
    outage:
      killAt !== undefined && restartedAt !== undefined
        ? {
            killAtMs: Math.round(killAt),
            restartedAtMs: Math.round(restartedAt),
            errorsDuringOutage: samples
              .filter((s) => s.status < 200 || s.status >= 300)
              .filter((s) => s.at >= killAt! && s.at <= restartedAt!).length,
            recoveryMs: recoveryMs === null ? null : Math.round(recoveryMs),
          }
        : undefined,
    invariants,
  };

  mkdirSync('results', { recursive: true });
  writeFileSync(`results/${variant}.${scenario.name}.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(
    `  ${result.completed} orders, ${result.throughput}/s, e2e p95 ${result.e2eMs.p95} ms, errors ${result.errors}, ` +
      `invariants ${invariants.ok ? 'ok' : 'BROKEN ' + JSON.stringify(invariants)}`,
  );
  return result;
}

export type Result = Awaited<ReturnType<typeof runScenario>>;
