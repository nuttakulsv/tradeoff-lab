import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

// A stand-in for an external card/PromptPay gateway. Charges are keyed by the
// Idempotency-Key header, like most real providers. /admin/* lets the lab inject faults.

interface Charge {
  id: string;
  key: string;
  amount: number;
  status: 'captured' | 'declined';
  createdAt: string;
}

interface Config {
  latencyMs: number;
  declineRate: number;
  unavailableRate: number;
  down: boolean;
}

const defaults: Config = { latencyMs: 50, declineRate: 0, unavailableRate: 0, down: false };
let config: Config = { ...defaults, ...JSON.parse(process.env.PROVIDER_CONFIG ?? '{}') };
const charges = new Map<string, Charge>();
const byId = new Map<string, Charge>();
const refunds = new Map<string, { id: string; chargeId: string; amount: number }>();
let requests = 0;

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://provider');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok' });
  if (req.method === 'GET' && path === '/ledger') {
    const captured = [...charges.values()].filter((c) => c.status === 'captured');
    return send(res, 200, { requests, charges: captured, refunds: [...refunds.values()] });
  }
  if (req.method === 'POST' && path === '/admin/config') {
    config = { ...config, ...(await readJson(req)) };
    return send(res, 200, config);
  }
  if (req.method === 'POST' && path === '/admin/reset') {
    charges.clear();
    byId.clear();
    refunds.clear();
    requests = 0;
    config = { ...defaults, ...(await readJson(req)) };
    return send(res, 200, config);
  }

  requests++;
  await sleep(config.latencyMs);
  if (config.down || Math.random() < config.unavailableRate) {
    return send(res, 503, { error: 'provider unavailable' });
  }

  if (req.method === 'POST' && path === '/charges') {
    const key = req.headers['idempotency-key'];
    const body = await readJson(req);
    if (typeof key !== 'string' || !Number.isInteger(body.amount) || body.amount < 0) {
      return send(res, 400, { error: 'idempotency-key header and integer amount are required' });
    }
    let charge = charges.get(key);
    if (!charge) {
      charge = {
        id: `ch_${randomUUID()}`,
        key,
        amount: body.amount,
        status: Math.random() < config.declineRate ? 'declined' : 'captured',
        createdAt: new Date().toISOString(),
      };
      charges.set(key, charge);
      byId.set(charge.id, charge);
    }
    return send(res, charge.status === 'captured' ? 201 : 402, charge);
  }

  const byKey = path.match(/^\/charges\/by-key\/([^/]+)$/);
  if (req.method === 'GET' && byKey) {
    const charge = charges.get(decodeURIComponent(byKey[1]));
    return charge ? send(res, 200, charge) : send(res, 404, { error: 'not found' });
  }

  const refund = path.match(/^\/charges\/([^/]+)\/refund$/);
  if (req.method === 'POST' && refund) {
    const charge = byId.get(refund[1]);
    if (!charge || charge.status !== 'captured') return send(res, 404, { error: 'not found' });
    let r = refunds.get(charge.id);
    if (!r)
      refunds.set(
        charge.id,
        (r = { id: `re_${randomUUID()}`, chargeId: charge.id, amount: charge.amount }),
      );
    return send(res, 201, r);
  }

  send(res, 404, { error: 'not found' });
}

const port = Number(process.env.PORT ?? 4010);
createServer((req, res) => {
  handle(req, res).catch((err) => send(res, 500, { error: String(err) }));
}).listen(port, () => console.log(`payment provider listening on ${port}`));
