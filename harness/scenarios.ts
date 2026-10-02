import type { VariantName } from './variants.js';

export interface TimelineStep {
  atMs: number;
  label: string;
  action: 'provider' | 'kill' | 'restart';
  provider?: Record<string, unknown>;
}

export interface Scenario {
  name: string;
  title: string;
  concurrency: number;
  durationMs: number;
  provider: Record<string, unknown>;
  items?: () => { sku: string; qty: number }[];
  duplicateRequests?: boolean;
  env?: (variant: VariantName) => Record<string, string>;
  timeline?: TimelineStep[];
}

const MENU = ['THAI-TEA', 'LATTE', 'CROISSANT'];
export function randomItems() {
  const count = 1 + Math.floor(Math.random() * 3);
  return Array.from({ length: count }, () => ({
    sku: MENU[Math.floor(Math.random() * MENU.length)],
    qty: 1 + Math.floor(Math.random() * 3),
  }));
}

// A payment gateway that answers in 50 ms is fast for the real world, so the baseline is about
// the architecture's own overhead rather than about waiting on somebody else's API.
const NORMAL = { latencyMs: 50 };

export const scenarios: Scenario[] = [
  ...[1, 16, 64].map((concurrency) => ({
    name: `baseline-c${concurrency}`,
    title: `Happy path, ${concurrency} concurrent customer${concurrency === 1 ? '' : 's'}`,
    concurrency,
    durationMs: 20_000,
    provider: NORMAL,
  })),
  {
    name: 'hot-item',
    title: '100 mooncake boxes, 32 customers racing for them',
    concurrency: 32,
    durationMs: 10_000,
    provider: NORMAL,
    items: () => [{ sku: 'MOONCAKE', qty: 1 }],
  },
  {
    name: 'slow-payment',
    title: 'Payment provider takes 2 s per charge',
    concurrency: 32,
    durationMs: 20_000,
    provider: { latencyMs: 2000 },
  },
  {
    name: 'payment-outage',
    title: 'Payment provider down from 5 s to 15 s',
    concurrency: 16,
    durationMs: 30_000,
    provider: NORMAL,
    timeline: [
      { atMs: 5_000, label: 'provider down', action: 'provider', provider: { down: true } },
      { atMs: 15_000, label: 'provider back', action: 'provider', provider: { down: false } },
    ],
  },
  {
    name: 'crash',
    title: 'kill -9 the inventory code at 8 s, restart at 13 s',
    concurrency: 16,
    durationMs: 30_000,
    provider: NORMAL,
    timeline: [
      { atMs: 8_000, label: 'kill', action: 'kill' },
      { atMs: 13_000, label: 'restart', action: 'restart' },
    ],
  },
  {
    name: 'duplicates',
    title: 'Every request sent twice, every broker message delivered twice',
    concurrency: 16,
    durationMs: 15_000,
    provider: NORMAL,
    duplicateRequests: true,
    env: (variant): Record<string, string> =>
      variant === 'microservices' ? { DUPLICATE_DELIVERY: '1' } : {},
  },
];
