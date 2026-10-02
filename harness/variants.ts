import { NATS_PORT, PROVIDER_PORT } from './infra.js';

export type VariantName = 'monolith' | 'microservices';

export interface ServiceSpec {
  name: string;
  script: string;
  port: number;
  database?: string;
  env: Record<string, string>;
}

export interface VariantSpec {
  name: VariantName;
  baseUrl: string;
  /** Database that holds orders.orders, inventory.products and so on, per schema. */
  databases: { orders: string; inventory: string; payments: string; notifications: string };
  usesBroker: boolean;
  services: ServiceSpec[];
  /** The process the crash scenario kills. */
  crashTarget: string;
}

const providerUrl = `http://127.0.0.1:${PROVIDER_PORT}`;
const natsUrl = `nats://127.0.0.1:${NATS_PORT}`;

export function variantSpec(
  name: VariantName,
  dbUrl: (db: string) => string,
  extra: Record<string, string> = {},
): VariantSpec {
  if (name === 'monolith') {
    return {
      name,
      baseUrl: 'http://127.0.0.1:4000',
      databases: {
        orders: 'monolith',
        inventory: 'monolith',
        payments: 'monolith',
        notifications: 'monolith',
      },
      usesBroker: false,
      crashTarget: 'monolith',
      services: [
        {
          name: 'monolith',
          script: 'dist/monolith/main.js',
          port: 4000,
          database: 'monolith',
          env: {
            DATABASE_URL: dbUrl('monolith'),
            PAYMENT_URL: providerUrl,
            RECOVERY_AFTER_MS: '10000',
            RECOVERY_INTERVAL_MS: '1000',
            ...extra,
          },
        },
      ],
    };
  }

  const service = (svc: string, port: number, env: Record<string, string> = {}): ServiceSpec => ({
    name: svc,
    script: `dist/microservices/${svc}/main.js`,
    port,
    database: svc,
    env: { DATABASE_URL: dbUrl(svc), NATS_URL: natsUrl, ...env, ...extra },
  });

  return {
    name,
    baseUrl: 'http://127.0.0.1:4100',
    databases: {
      orders: 'orders',
      inventory: 'inventory',
      payments: 'payments',
      notifications: 'notifications',
    },
    usesBroker: true,
    crashTarget: 'inventory',
    services: [
      service('orders', 4101),
      service('inventory', 4102),
      service('payments', 4103, { PAYMENT_URL: providerUrl }),
      service('notifications', 4104),
      {
        name: 'gateway',
        script: 'dist/microservices/gateway/main.js',
        port: 4100,
        env: {
          ORDERS_URL: 'http://127.0.0.1:4101',
          INVENTORY_URL: 'http://127.0.0.1:4102',
          ...extra,
        },
      },
    ],
  };
}
