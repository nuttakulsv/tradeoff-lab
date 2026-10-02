import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Lines that are not blank and not only a comment. */
function loc(path: string) {
  let count = 0;
  let inBlock = false;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      inBlock = !line.includes('*/');
      continue;
    }
    count++;
  }
  return count;
}

const sum = (paths: string[]) => paths.reduce((n, p) => n + loc(p), 0);
const ts = (dir: string) => files(dir).filter((f) => f.endsWith('.ts'));

/** Lines added and removed per file in a unified diff, ignoring test files. */
function patchSize(path: string) {
  const perFile: Record<string, { added: number; removed: number }> = {};
  let current = '';
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('+++ ')) {
      current = line.slice(6);
      perFile[current] = { added: 0, removed: 0 };
    } else if (current && line.startsWith('+') && !line.startsWith('+++')) perFile[current].added++;
    else if (current && line.startsWith('-') && !line.startsWith('---')) perFile[current].removed++;
  }
  const source = Object.entries(perFile).filter(([file]) => file.startsWith('src/'));
  return {
    files: source.map(([file, n]) => ({ file, ...n })),
    filesTouched: source.length,
    linesChanged: source.reduce((n, [, c]) => n + c.added + c.removed, 0),
  };
}

export function staticStats() {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const profiles = [...compose.matchAll(/^    profiles: \[(.*)\]$/gm)].map((m) => m[1].split(', '));
  const servicesIn = (profile: string) => profiles.filter((p) => p.includes(profile)).length;
  const envVars = (profile: string) =>
    compose
      .split(/\n(?=  [\w-]+:\n)/)
      .filter((block) => block.includes(`profiles: [${profile}]`))
      .reduce((n, block) => n + (block.match(/^      [A-Z_]+: /gm)?.length ?? 0), 0);

  const shared = sum(ts('src/shared'));
  const monolith = sum(ts('src/monolith'));
  const microservices = sum(ts('src/microservices'));
  return {
    loc: { shared, monolith, microservices },
    deployableUnits: { monolith: 1, microservices: 5 },
    composeServices: {
      monolith: servicesIn('monolith'),
      microservices: servicesIn('microservices'),
    },
    appEnvVars: { monolith: envVars('monolith'), microservices: envVars('microservices') },
    databases: { monolith: 1, microservices: 4 },
    brokers: { monolith: 0, microservices: 1 },
    exercises: {
      'discount-code': {
        monolith: patchSize('exercises/discount-code/monolith.patch'),
        microservices: patchSize('exercises/discount-code/microservices.patch'),
      },
    },
  };
}

export async function writeStatic() {
  const stats = staticStats();
  mkdirSync('results', { recursive: true });
  writeFileSync('results/static.json', JSON.stringify(stats, null, 2) + '\n');
  console.log(JSON.stringify(stats, null, 2));
}
