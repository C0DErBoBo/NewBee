"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.migrate = migrate;
const pg_1 = require("pg");
const env_1 = require("../config/env");
exports.pool = new pg_1.Pool({
    connectionString: env_1.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000
});
async function migrate() {
    const migrationSql = `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      phone VARCHAR(20) UNIQUE,
      password_hash TEXT,
      wechat_openid VARCHAR(64),
      display_name TEXT,
      role VARCHAR(32) NOT NULL DEFAULT 'organizer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS competitions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL,
      location TEXT,
      start_at TIMESTAMPTZ,
      end_at TIMESTAMPTZ,
      signup_start_at TIMESTAMPTZ,
      signup_end_at TIMESTAMPTZ,
      config JSONB,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS competition_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit_type TEXT NOT NULL,
      competition_mode TEXT,
      scoring_type TEXT,
      is_custom BOOLEAN NOT NULL DEFAULT FALSE,
      config JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS competition_groups (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      gender TEXT NOT NULL,
      age_bracket TEXT,
      identity_type TEXT,
      max_participants INTEGER,
      team_size INTEGER,
      config JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS competition_rules (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      competition_id UUID NOT NULL UNIQUE REFERENCES competitions(id) ON DELETE CASCADE,
      scoring JSONB NOT NULL DEFAULT '{}'::JSONB,
      flow JSONB NOT NULL DEFAULT '{}'::JSONB,
      penalties JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS teams (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL,
      contact_phone VARCHAR(20),
      members JSONB NOT NULL DEFAULT '[]'::JSONB,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS competition_registrations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
      participant_name TEXT NOT NULL,
      participant_gender TEXT,
      participant_identity TEXT,
      contact TEXT,
      extra JSONB NOT NULL DEFAULT '{}'::JSONB,
      attachments JSONB NOT NULL DEFAULT '[]'::JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS competition_registration_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      registration_id UUID NOT NULL REFERENCES competition_registrations(id) ON DELETE CASCADE,
      event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
      group_id UUID REFERENCES competition_groups(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (registration_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_registration_competition ON competition_registrations(competition_id);
    CREATE INDEX IF NOT EXISTS idx_registration_user ON competition_registrations(user_id);
    CREATE INDEX IF NOT EXISTS idx_registration_events_reg ON competition_registration_events(registration_id);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS verification_codes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      phone VARCHAR(20) NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_verification_codes_phone ON verification_codes(phone);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_openid ON users(wechat_openid) WHERE wechat_openid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_competition_events_competition ON competition_events(competition_id);
    CREATE INDEX IF NOT EXISTS idx_competition_groups_competition ON competition_groups(competition_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_user ON teams(user_id);

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS display_name TEXT,
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'role'
      ) THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(32) DEFAULT 'organizer';
      END IF;
      UPDATE users SET role = 'organizer' WHERE role IS NULL;
      ALTER TABLE users ALTER COLUMN role SET DEFAULT 'organizer';
    END $$;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_phone_key'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_wechat_openid_key'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_wechat_openid_key UNIQUE (wechat_openid);
      END IF;
    END $$;

    ALTER TABLE competitions
      ADD COLUMN IF NOT EXISTS signup_start_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS signup_end_at TIMESTAMPTZ;

    ALTER TABLE competition_events
      ADD COLUMN IF NOT EXISTS competition_mode TEXT,
      ADD COLUMN IF NOT EXISTS scoring_type TEXT;
  `;
    await exports.pool.query(migrationSql);
}
exports.pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('PostgreSQL 连接异常', err);
});
