import { Router } from 'express';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../database/client';
import { authGuard, AuthenticatedRequest } from '../middleware/authGuard';

const teamRouter = Router();

teamRouter.use(authGuard);

teamRouter.use((req: AuthenticatedRequest, res, next) => {
  if (req.user?.role !== 'team') {
    return res.status(403).json({ message: '仅限队伍账号访问' });
  }
  next();
});

type Queryable = Pool | PoolClient;

async function ensureTeam(userId: string, client: Queryable = pool) {
  const teamResult = await client.query(
    `
      SELECT id, name, members
      FROM teams
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (teamResult.rows.length > 0) {
    return teamResult.rows[0];
  }

  const userResult = await client.query(
    `
      SELECT phone, display_name
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  const userRow = userResult.rows[0];
  const defaultName = userRow?.display_name ?? userRow?.phone ?? '未命名队伍';

  const insertResult = await client.query(
    `
      INSERT INTO teams (name, contact_phone, members, user_id)
      VALUES ($1, $2, '[]', $3)
      RETURNING id, name, members
    `,
    [defaultName, userRow?.phone ?? null, userId]
  );

  return insertResult.rows[0];
}

const eventSchema = z.object({
  name: z.string().trim().max(100).optional().nullable(),
  result: z.string().trim().max(100).optional().nullable()
});

const memberSchema = z.object({
  name: z.string().trim().min(1),
  gender: z.string().trim().max(50).optional().nullable(),
  group: z.string().trim().max(100).optional().nullable(),
  events: z.array(eventSchema).max(5).default([])
});

const membersPayloadSchema = z.object({
  members: z.array(memberSchema),
  competitionId: z.string().uuid().optional()
});

async function syncCompetitionRegistrations(options: {
  client: PoolClient;
  userId: string;
  teamId: string;
  competitionId: string;
  members: Array<z.infer<typeof memberSchema>>;
}) {
  const { client, userId, teamId, competitionId, members } = options;

  const eventsResult = await client.query(
    `
      SELECT id, name
      FROM competition_events
      WHERE competition_id = $1
    `,
    [competitionId]
  );

  const eventMap = new Map<string, string>();
  eventsResult.rows.forEach((row) => {
    if (row.name) {
      eventMap.set(String(row.name).trim(), row.id as string);
    }
  });

  const existingRegistrationsResult = await client.query(
    `
      SELECT id, participant_name, status
      FROM competition_registrations
      WHERE competition_id = $1
        AND team_id = $2
    `,
    [competitionId, teamId]
  );

  const existingMap = new Map<string, { id: string; status: string }>();
  existingRegistrationsResult.rows.forEach((row) => {
    if (row.participant_name) {
      existingMap.set(String(row.participant_name).trim(), {
        id: row.id as string,
        status: row.status as string
      });
    }
  });

  const processedIds = new Set<string>();

  for (const member of members) {
    const participantName = member.name.trim();
    if (!participantName) continue;

    const eventIds = (member.events ?? [])
      .map((event) => (event?.name ? eventMap.get(event.name.trim()) : undefined))
      .filter((value): value is string => Boolean(value));

    if (!eventIds.length) {
      continue;
    }

    const existing = existingMap.get(participantName);
    let registrationId: string;

    if (existing) {
      await client.query(
        `
          UPDATE competition_registrations
          SET participant_gender = $1,
              participant_identity = $2,
              extra = jsonb_set(
                jsonb_set(
                  COALESCE(extra, '{}'::jsonb),
                  '{group}',
                  COALESCE(to_jsonb($2::text), 'null'::jsonb),
                  true
                ),
                '{gender}',
                COALESCE(to_jsonb($1::text), 'null'::jsonb),
                true
              ),
              updated_at = NOW()
          WHERE id = $3
        `,
        [member.gender ?? null, member.group ?? null, existing.id]
      );

      if (existing.status === 'cancelled') {
        await client.query(
          `
            UPDATE competition_registrations
            SET status = 'pending', updated_at = NOW()
            WHERE id = $1
          `,
          [existing.id]
        );
      }

      registrationId = existing.id;
    } else {
      const insertResult = await client.query(
        `
          INSERT INTO competition_registrations (
            competition_id,
            user_id,
            team_id,
            participant_name,
            participant_gender,
            participant_identity,
            contact,
            extra,
            attachments,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6, NULL,
            jsonb_build_object('group', $6, 'gender', $5),
            '[]', 'pending')
          RETURNING id
        `,
        [competitionId, userId, teamId, participantName, member.gender ?? null, member.group ?? null]
      );
      registrationId = insertResult.rows[0].id as string;
    }

    processedIds.add(registrationId);

    await client.query(
      `DELETE FROM competition_registration_events WHERE registration_id = $1`,
      [registrationId]
    );

    for (const eventId of eventIds) {
      await client.query(
        `
          INSERT INTO competition_registration_events (registration_id, event_id)
          VALUES ($1, $2)
          ON CONFLICT (registration_id, event_id) DO NOTHING
        `,
        [registrationId, eventId]
      );
    }
  }

  for (const row of existingRegistrationsResult.rows) {
    const registrationId = row.id as string;
    if (!processedIds.has(registrationId) && row.status !== 'cancelled') {
      await client.query(
        `
          UPDATE competition_registrations
          SET status = 'cancelled', updated_at = NOW()
          WHERE id = $1
        `,
        [registrationId]
      );
    }
  }
}

teamRouter.get('/members', async (req: AuthenticatedRequest, res, next) => {
  try {
    const team = await ensureTeam(req.user!.id);
    const members = Array.isArray(team.members) ? team.members : [];
    res.json({
      team: {
        id: team.id,
        name: team.name
      },
      members
    });
  } catch (error) {
    next(error);
  }
});

teamRouter.put('/members', async (req: AuthenticatedRequest, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const team = await ensureTeam(req.user!.id, client);
    const { members, competitionId } = membersPayloadSchema.parse(req.body);

    await client.query(
      `
        UPDATE teams
        SET members = $1
        WHERE id = $2
      `,
      [JSON.stringify(members), team.id]
    );

    if (competitionId) {
      await syncCompetitionRegistrations({
        client,
        userId: req.user!.id,
        teamId: team.id,
        competitionId,
        members
      });
    }

    await client.query('COMMIT');

    res.json({
      team: {
        id: team.id,
        name: team.name
      },
      members
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

export { teamRouter };

