import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { configureProvider, providerUrl, startInfra, startVariant } from './session.js';
import { runScenario } from './run.js';
import { scenarios } from './scenarios.js';
import { writeReport } from './report.js';
import { writeStatic } from './stats.js';
import type { VariantName } from './variants.js';

const VARIANTS: VariantName[] = ['monolith', 'microservices'];
const [command = 'help', ...args] = process.argv.slice(2);

function pickVariants(arg?: string): VariantName[] {
  if (!arg || arg === 'all') return VARIANTS;
  if (!VARIANTS.includes(arg as VariantName))
    throw new Error(`unknown variant ${arg}, use ${VARIANTS.join(' | ')}`);
  return [arg as VariantName];
}

function ensureBuilt() {
  if (!existsSync('dist/monolith/main.js')) {
    const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
}

async function contract(variants: VariantName[]) {
  let failed = false;
  for (const name of variants) {
    const infra = await startInfra(name === 'microservices');
    try {
      await configureProvider({ latencyMs: 0 }, true);
      const running = await startVariant(infra, name);
      console.log(`\n${name}: up in ${Math.round(running.coldStartMs)} ms, running contract tests`);
      const result = spawnSync('npx', ['vitest', 'run', '-c', 'vitest.contract.config.ts'], {
        stdio: 'inherit',
        env: { ...process.env, API_URL: running.spec.baseUrl, PAYMENT_PROVIDER_URL: providerUrl },
      });
      failed ||= result.status !== 0;
      await running.stop();
    } finally {
      await infra.stop();
    }
  }
  if (failed) process.exit(1);
}

async function up(name: VariantName) {
  const infra = await startInfra(name === 'microservices');
  await configureProvider({}, true);
  const running = await startVariant(infra, name);
  console.log(
    `${name} is up at ${running.spec.baseUrl} (provider admin at ${providerUrl}). Ctrl+C to stop.`,
  );
  const stop = async () => {
    await running.stop();
    await infra.stop();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function run(variantArg?: string, scenarioArg?: string, quick = false) {
  const chosen =
    !scenarioArg || scenarioArg === 'all'
      ? scenarios
      : scenarios.filter((s) => s.name === scenarioArg);
  if (!chosen.length)
    throw new Error(
      `unknown scenario ${scenarioArg}, use: ${scenarios.map((s) => s.name).join(', ')}`,
    );
  for (const name of pickVariants(variantArg)) {
    const infra = await startInfra(name === 'microservices');
    try {
      for (const scenario of chosen) await runScenario(infra, name, scenario, { quick });
    } finally {
      await infra.stop();
    }
  }
}

const help = `usage: npm run lab -- <command>

  contract [monolith|microservices|all]     run the shared contract tests against a variant
  up <monolith|microservices>               start a variant and keep it running
  run <variant|all> <scenario|all> [--quick] run load and failure scenarios, write results/
  report                                    rebuild results/summary.md and the charts
  stats                                     count code, files and deployable units

scenarios: ${scenarios.map((s) => s.name).join(', ')}`;

ensureBuilt();
switch (command) {
  case 'contract':
    await contract(pickVariants(args[0]));
    break;
  case 'up':
    await up(pickVariants(args[0])[0]);
    break;
  case 'run':
    await run(args[0], args[1], args.includes('--quick'));
    break;
  case 'report':
    await writeReport();
    break;
  case 'stats':
    await writeStatic();
    break;
  default:
    console.log(help);
}
