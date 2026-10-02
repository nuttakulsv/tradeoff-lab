import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { Result } from './run.js';
import { scenarios } from './scenarios.js';
import { staticStats } from './stats.js';

const C = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  band: '#f1f0ec',
  monolith: '#2a78d6',
  microservices: '#eb6834',
};
const FONT = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`;
const VARIANTS = ['monolith', 'microservices'] as const;
const LABEL = { monolith: 'Modular monolith', microservices: 'Microservices + events' };

function load(): Result[] {
  return readdirSync('results')
    .filter((f) => f.endsWith('.json') && f !== 'static.json')
    .map((f) => JSON.parse(readFileSync(`results/${f}`, 'utf8')) as Result);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x: number, y: number, s: string, attrs = '') => {
  const defaults = [`font-size="12"`, `fill="${C.ink2}"`].filter(
    (d) => !attrs.includes(d.split('=')[0] + '='),
  );
  return `<text x="${x}" y="${y}" ${FONT} ${defaults.join(' ')} ${attrs}>${esc(s)}</text>`;
};

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

function legend(x: number, y: number) {
  return VARIANTS.map((v, i) => {
    const lx = x + i * 190;
    return `<rect x="${lx}" y="${y - 9}" width="10" height="10" rx="2" fill="${C[v]}"/>${text(lx + 16, y, LABEL[v], `fill="${C.ink}"`)}`;
  }).join('');
}

function frame(width: number, height: number, title: string, subtitle: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
<rect width="${width}" height="${height}" rx="12" fill="${C.surface}"/>
<text x="24" y="34" ${FONT} font-size="16" font-weight="600" fill="${C.ink}">${esc(title)}</text>
${text(24, 54, subtitle)}
${legend(24, 82)}
${body}
</svg>
`;
}

/** One panel of grouped columns: a group per concurrency level, a column per variant. */
function columns(
  x0: number,
  y0: number,
  w: number,
  h: number,
  title: string,
  unit: string,
  groups: string[],
  values: Record<string, number[]>,
) {
  const max = niceMax(Math.max(...Object.values(values).flat()));
  const out = [text(x0, y0 - 14, title, `fill="${C.ink}" font-weight="600"`)];
  for (let i = 0; i <= 4; i++) {
    const y = y0 + h - (h * i) / 4;
    out.push(
      `<line x1="${x0 + 40}" x2="${x0 + w}" y1="${y}" y2="${y}" stroke="${i ? C.grid : C.axis}" stroke-width="1"/>`,
    );
    out.push(
      text(
        x0 + 34,
        y + 4,
        `${Math.round((max * i) / 4)}`,
        `text-anchor="end" fill="${C.muted}" font-variant-numeric="tabular-nums"`,
      ),
    );
  }
  const slot = (w - 40) / groups.length;
  const bar = Math.min(24, slot / 3);
  groups.forEach((g, gi) => {
    const cx = x0 + 40 + slot * gi + slot / 2;
    VARIANTS.forEach((v, vi) => {
      const value = values[v][gi];
      const bh = Math.max(1, (value / max) * h);
      const bx = cx - bar - 1 + vi * (bar + 2);
      const by = y0 + h - bh;
      const r = Math.min(4, bh);
      out.push(
        `<path d="M${bx},${y0 + h} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + bar - r} Q${bx + bar},${by} ${bx + bar},${by + r} V${y0 + h} Z" fill="${C[v]}"><title>${LABEL[v]}, ${g}: ${value} ${unit}</title></path>`,
      );
      out.push(
        text(
          bx + bar / 2,
          by - 6,
          `${Math.round(value)}`,
          `text-anchor="middle" font-size="11" fill="${C.ink2}" font-variant-numeric="tabular-nums"`,
        ),
      );
    });
    out.push(text(cx, y0 + h + 18, g, `text-anchor="middle" fill="${C.muted}"`));
  });
  return out.join('\n');
}

function lines(
  results: Record<string, Result | undefined>,
  title: string,
  subtitle: string,
  marks: { at: number; to?: number; label: string }[],
) {
  const W = 760;
  const H = 360;
  const x0 = 64;
  const y0 = 110;
  const w = W - x0 - 150;
  const h = H - y0 - 50;
  // The last bucket is a partial second, so it is left out.
  const series = VARIANTS.map((v) => results[v]?.series.slice(0, -1).map((s) => s.completed) ?? []);
  const seconds = Math.max(...series.map((s) => s.length));
  const max = niceMax(Math.max(...series.flat(), 1));
  const px = (t: number) => x0 + (t / Math.max(1, seconds)) * w;
  const py = (v: number) => y0 + h - (v / max) * h;

  const out: string[] = [];
  for (const m of marks) {
    if (m.to !== undefined) {
      out.push(
        `<rect x="${px(m.at)}" y="${y0}" width="${px(m.to) - px(m.at)}" height="${h}" fill="${C.band}"/>`,
      );
      out.push(text(px(m.at) + 6, y0 + 14, m.label, `fill="${C.ink2}"`));
    } else {
      out.push(
        `<line x1="${px(m.at)}" x2="${px(m.at)}" y1="${y0}" y2="${y0 + h}" stroke="${C.muted}" stroke-dasharray="4 4"/>`,
      );
      out.push(text(px(m.at) + 6, y0 + 14, m.label, `fill="${C.ink2}"`));
    }
  }
  for (let i = 0; i <= 4; i++) {
    const y = y0 + h - (h * i) / 4;
    out.push(
      `<line x1="${x0}" x2="${x0 + w}" y1="${y}" y2="${y}" stroke="${i ? C.grid : C.axis}"/>`,
    );
    out.push(
      text(
        x0 - 8,
        y + 4,
        `${Math.round((max * i) / 4)}`,
        `text-anchor="end" fill="${C.muted}" font-variant-numeric="tabular-nums"`,
      ),
    );
  }
  for (let t = 0; t <= seconds; t += 5)
    out.push(text(px(t), y0 + h + 18, `${t}s`, `text-anchor="middle" fill="${C.muted}"`));
  out.push(text(x0, y0 - 10, 'confirmed orders per second', `fill="${C.muted}"`));

  VARIANTS.forEach((v, vi) => {
    const s = series[vi];
    if (!s.length) return;
    const d = s
      .map((value, t) => `${t ? 'L' : 'M'}${px(t + 0.5).toFixed(1)},${py(value).toFixed(1)}`)
      .join(' ');
    out.push(
      `<path d="${d}" fill="none" stroke="${C[v]}" stroke-width="2" stroke-linejoin="round"/>`,
    );
    const last = s.length - 1;
    out.push(
      text(px(last + 0.5) + 8, py(s[last]) + 4 + (vi ? 8 : -8), LABEL[v], `fill="${C.ink}"`),
    );
  });
  return frame(W, H, title, subtitle, out.join('\n'));
}

const fmt = (n: number | null | undefined, unit = '') =>
  n === null || n === undefined ? 'n/a' : `${n.toLocaleString('en-US')}${unit}`;

export async function writeReport() {
  const all = load();
  if (!all.length) throw new Error('no results yet, run `npm run lab -- run all all` first');
  const get = (variant: string, scenario: string) =>
    all.find((r) => r.variant === variant && r.scenario === scenario);
  mkdirSync('docs/charts', { recursive: true });

  const levels = [1, 16, 64].filter((c) => VARIANTS.every((v) => get(v, `baseline-c${c}`)));
  if (levels.length) {
    const groups = levels.map((c) => `${c} customer${c === 1 ? '' : 's'}`);
    const pick = (f: (r: Result) => number) =>
      Object.fromEntries(
        VARIANTS.map((v) => [v, levels.map((c) => f(get(v, `baseline-c${c}`)!))]),
      ) as Record<string, number[]>;
    const body =
      columns(
        40,
        140,
        320,
        200,
        'Confirmed orders per second',
        'orders/s',
        groups,
        pick((r) => r.confirmedPerSecond),
      ) +
      columns(
        420,
        140,
        320,
        200,
        'Time to a final answer, p95 (ms)',
        'ms',
        groups,
        pick((r) => r.e2eMs.p95),
      );
    const m = all[0].machine;
    writeFileSync(
      'docs/charts/baseline.svg',
      frame(
        780,
        380,
        'Happy path: same orders, two architectures',
        `${m.cpu}, ${m.cores} cores, ${m.memoryGb} GB, Node ${m.node}. Payment provider answers in 50 ms.`,
        body,
      ),
    );
  }

  const crash = Object.fromEntries(VARIANTS.map((v) => [v, get(v, 'crash')]));
  if (crash.monolith && crash.microservices) {
    const t = (label: string) =>
      (crash.monolith!.timeline.find((e) => e.label === label)?.atMs ?? 0) / 1000;
    writeFileSync(
      'docs/charts/crash.svg',
      lines(
        crash,
        'kill -9 on the inventory code, 16 customers',
        'Monolith: the whole process dies. Microservices: only the inventory service dies.',
        [
          { at: t('kill'), label: 'kill -9' },
          { at: t('restart'), label: 'restart' },
        ],
      ),
    );
  }

  const outage = Object.fromEntries(VARIANTS.map((v) => [v, get(v, 'payment-outage')]));
  if (outage.monolith && outage.microservices) {
    const t = (label: string) =>
      (outage.monolith!.timeline.find((e) => e.label === label)?.atMs ?? 0) / 1000;
    writeFileSync(
      'docs/charts/outage.svg',
      lines(
        outage,
        'Payment provider down for 10 seconds, 16 customers',
        'Monolith rejects while it is down. Microservices keep orders pending and retry.',
        [{ at: t('provider down'), to: t('provider back'), label: 'provider down' }],
      ),
    );
  }

  const stats = existsSync('docker-compose.yml') ? staticStats() : undefined;
  const md: string[] = [];
  const m = all[0].machine;
  md.push('# Results', '');
  md.push(
    `Machine: ${m.cpu}, ${m.cores} cores, ${m.memoryGb} GB RAM, ${m.os}, Node ${m.node}. Everything (PostgreSQL, NATS, the fake payment provider, the load generator) ran on this one machine.`,
    '',
  );
  if (all.some((r) => r.quick))
    md.push(
      '> Some of these runs used `--quick` (20% duration). Use full runs for anything you publish.',
      '',
    );

  md.push('## Scenarios', '');
  md.push(
    '| Scenario | Variant | Orders done | Confirmed/s | Rejected | Errors | Answer p50 / p95 / p99 (ms) | POST p95 (ms) | Server p95 (ms) | Consistency |',
  );
  md.push('|---|---|---:|---:|---:|---:|---|---:|---:|---|');
  for (const s of scenarios) {
    for (const v of VARIANTS) {
      const r = get(v, s.name);
      if (!r) continue;
      const inv = r.invariants;
      const broken = Object.entries({
        stuck: inv.stuck,
        'duplicate orders': inv.duplicateOrders,
        'stock leaked': inv.stockLeaked,
        oversold: inv.stockOversold,
        'charged, no order': inv.chargedWithoutOrder,
        'confirmed, no charge': inv.confirmedWithoutCharge,
        'missing notification': inv.missingNotifications,
      })
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`);
      md.push(
        `| ${s.name} | ${v} | ${fmt(r.completed)} | ${r.confirmedPerSecond} | ${fmt(r.rejected)} | ${fmt(r.errors)} | ${r.e2eMs.p50} / ${r.e2eMs.p95} / ${r.e2eMs.p99} | ${r.requestMs.p95} | ${r.serverMs?.p95 ?? 'n/a'} | ${broken.length ? broken.join(', ') : 'ok'} |`,
      );
    }
  }
  md.push('');
  md.push(
    '"Answer" is the time a customer waits from POST until the order shows CONFIRMED or REJECTED, including polling every 50 ms when the API answers 202. "Server" is `updated_at - created_at` of finished orders, without the polling.',
    '',
  );

  const failures = ['slow-payment', 'payment-outage', 'crash'].flatMap((name) =>
    VARIANTS.map((v) => get(v, name)).filter((r): r is Result => !!r),
  );
  if (failures.length) {
    md.push('## Failures', '');
    md.push(
      '| Scenario | Variant | Rejected (reason) | Errors seen by clients | Answers slower than 1 s | Longest wait (ms) | Recovery after restart |',
    );
    md.push('|---|---|---|---:|---:|---:|---|');
    for (const r of failures) {
      const reasons =
        Object.entries(r.reasons)
          .map(([k, n]) => `${n} ${k}`)
          .join(', ') || '0';
      md.push(
        `| ${r.scenario} | ${r.variant} | ${reasons} | ${fmt(r.errors)} | ${fmt(r.slowAnswers)} | ${fmt(r.e2eMs.max)} | ${r.outage ? fmt(r.outage.recoveryMs, ' ms') : 'n/a'} |`,
      );
    }
    md.push('');
  }

  md.push('## Running cost on this machine', '');
  md.push('| Variant | Cold start (ms) | App memory idle / peak (MB) | Broker memory (MB) |');
  md.push('|---|---:|---|---:|');
  for (const v of VARIANTS) {
    const r = get(v, 'baseline-c16');
    if (r)
      md.push(
        `| ${v} | ${fmt(r.coldStartMs)} | ${r.memory.idleRssMb} / ${r.memory.peakRssMb} | ${r.memory.brokerRssMb} |`,
      );
  }
  md.push('');

  if (stats) {
    const ex = stats.exercises['discount-code'];
    md.push('## Code and moving parts', '');
    md.push('| | Monolith | Microservices |');
    md.push('|---|---:|---:|');
    md.push(`| Lines of TypeScript (own) | ${stats.loc.monolith} | ${stats.loc.microservices} |`);
    md.push(`| Lines shared by both (contract, SQL) | ${stats.loc.shared} | ${stats.loc.shared} |`);
    md.push(
      `| Deployable units | ${stats.deployableUnits.monolith} | ${stats.deployableUnits.microservices} |`,
    );
    md.push(
      `| Containers in docker-compose | ${stats.composeServices.monolith} | ${stats.composeServices.microservices} |`,
    );
    md.push(
      `| App environment variables | ${stats.appEnvVars.monolith} | ${stats.appEnvVars.microservices} |`,
    );
    md.push(`| Databases | ${stats.databases.monolith} | ${stats.databases.microservices} |`);
    md.push(`| Message brokers | ${stats.brokers.monolith} | ${stats.brokers.microservices} |`);
    md.push(
      `| "Add a discount code": files / lines changed | ${ex.monolith.filesTouched} / ${ex.monolith.linesChanged} | ${ex.microservices.filesTouched} / ${ex.microservices.linesChanged} |`,
    );
    md.push('');
  }

  writeFileSync('results/summary.md', md.join('\n'));
  console.log(`wrote results/summary.md and docs/charts/*.svg from ${all.length} result files`);
}
