import pg from 'pg';

export type Pool = pg.Pool;
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string, max = Number(process.env.DB_POOL_MAX ?? 20)) {
  const pool = new pg.Pool({ connectionString, max });
  // An idle client losing its connection (database restart, failover) must not crash the process.
  pool.on('error', (err) => console.warn(`postgres idle client: ${err.message}`));
  return pool;
}

export async function tx<T>(pool: Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
