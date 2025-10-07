import { Pool } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000
});

export async function migrate() {
  const migrationSql = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone VARCHAR(20),
      wechat_openid VARCHAR(64),
      password_hash TEXT,
      role VARCHAR(32) NOT NULL DEFAULT 'organizer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS competitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      location TEXT,
      start_at TIMESTAMPTZ,
      end_at TIMESTAMPTZ,
      config JSONB,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.query(migrationSql);
}

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('PostgreSQL 连接异常', err);
});
