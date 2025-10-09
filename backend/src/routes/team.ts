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
  events: z.array(eventSchema).max(5).default([]),
  registered: z.boolean().optional().default(false)
});

const membersPayloadSchema = z.object({
  members: z.array(memberSchema),
  competitionId: z.string().uuid().optional()
});

const membersQuerySchema = z.object({
  competitionId: z.string().uuid().optional()
});

function normalizeMemberRecord(input: unknown): z.infer<typeof memberSchema> | null {
  const candidate =
    typeof input === 'object' && input !== null
      ? {
          ...(input as Record<string, unknown>),
          events: Array.isArray((input as Record<string, unknown>).events)
            ? (input as Record<string, unknown>).events
            : []
        }
      : { events: [] };

  const parsed = memberSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }

  const base = parsed.data;
  const normalizedEvents = (base.events ?? [])
    .map((event) => ({
      name: event.name?.trim() || null,
      result: event.result?.trim() || null
    }))
    .filter((event, index) => index < 5 && (event.name || event.result));

  return {
    name: base.name.trim(),
    gender: base.gender?.trim() || null,
    group: base.group?.trim() || null,
    events: normalizedEvents,
    registered: Boolean(base.registered)
  };
}

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
              extra = jsonb_strip_nulls(
                COALESCE(extra, '{}'::jsonb) ||
                jsonb_build_object('group', $2::text, 'gender', $1::text)
              ),
              status = 'approved',
              updated_at = NOW()
          WHERE id = $3
        `,
        [member.gender ?? null, member.group ?? null, existing.id]
      );

      if (existing.status === 'cancelled') {
        await client.query(
          `
            UPDATE competition_registrations
            SET status = 'approved', updated_at = NOW()
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
            jsonb_build_object('group', $6::text, 'gender', $5::text),
            '[]', 'approved')
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
    const { competitionId } = membersQuerySchema.parse(req.query);
    const team = await ensureTeam(req.user!.id);

    const baseMembersRaw = Array.isArray(team.members) ? team.members : [];
    const baseMembers: Array<z.infer<typeof memberSchema>> = [];
    const nameIndexMap = new Map<string, number[]>();

    baseMembersRaw.forEach((item) => {
      const normalized = normalizeMemberRecord(item);
      if (!normalized) {
        return;
      }
      baseMembers.push(normalized);

      const key = normalized.name.trim().toLowerCase();
      if (!key) {
        return;
      }
      const indexes = nameIndexMap.get(key) ?? [];
      indexes.push(baseMembers.length - 1);
      nameIndexMap.set(key, indexes);
    });

    let members = [...baseMembers];

    if (competitionId) {
      const registrationResult = await pool.query(
        `
          SELECT
            cr.id,
            cr.participant_name,
            cr.participant_gender,
            cr.extra->>'group' AS participant_group,
            ce.name AS event_name,
            cr.created_at
          FROM competition_registrations cr
          LEFT JOIN competition_registration_events cre
            ON cre.registration_id = cr.id
          LEFT JOIN competition_events ce
            ON ce.id = cre.event_id
          WHERE cr.competition_id = $1
            AND cr.team_id = $2
            AND cr.status <> 'cancelled'
          ORDER BY cr.created_at ASC, ce.name ASC
        `,
        [competitionId, team.id]
      );

      if (registrationResult.rows.length > 0) {
        const memberMap = new Map<
          string,
          {
            name: string;
            gender: string | null;
            group: string | null;
            events: Array<{ name: string | null; result: string | null }>;
            createdAt: Date | null;
          }
        >();

        registrationResult.rows.forEach((row) => {
          const participantName =
            typeof row.participant_name === 'string' ? row.participant_name.trim() : '';
          if (!participantName) {
            return;
          }

          const mapKey = String(row.id);
          let member = memberMap.get(mapKey);

          if (!member) {
            const gender =
              typeof row.participant_gender === 'string'
                ? row.participant_gender.trim() || null
                : null;
            const groupName =
              typeof row.participant_group === 'string'
                ? row.participant_group.trim() || null
                : null;

            member = {
              name: participantName,
              gender,
              group: groupName,
              events: [],
              createdAt: row.created_at ? new Date(row.created_at) : null
            };
            memberMap.set(mapKey, member);
          }

          const eventName =
            typeof row.event_name === 'string' ? row.event_name.trim() : null;
          if (eventName && !member.events.some((event) => event.name === eventName)) {
            member.events.push({ name: eventName, result: null });
          }
        });

        const registrationMembers = Array.from(memberMap.values())
          .sort((a, b) => {
            const timeA = a.createdAt?.getTime() ?? 0;
            const timeB = b.createdAt?.getTime() ?? 0;
            return timeA - timeB;
          })
          .map(({ createdAt: _createdAt, ...member }) => normalizeMemberRecord(member))
          .filter((member): member is z.infer<typeof memberSchema> => Boolean(member));

        const appendedMembers: Array<z.infer<typeof memberSchema>> = [];

        registrationMembers.forEach((regMember) => {
          const key = regMember.name.trim().toLowerCase();
          if (!key) {
            appendedMembers.push({ ...regMember, registered: true });
            return;
          }

          const indexList = nameIndexMap.get(key);
          if (indexList && indexList.length) {
            const targetIndex = indexList.shift()!;
            if (indexList.length === 0) {
              nameIndexMap.delete(key);
            } else {
              nameIndexMap.set(key, indexList);
            }

            const existing = members[targetIndex] ?? regMember;
            members[targetIndex] = {
              ...existing,
              name: regMember.name,
              gender: regMember.gender ?? existing.gender ?? null,
              group: regMember.group ?? existing.group ?? null,
              events:
                regMember.events.length > 0
                  ? regMember.events
                  : (existing.events ?? []),
              registered: true
            };
          } else {
            appendedMembers.push({ ...regMember, registered: true });
          }
        });

        members = [...members, ...appendedMembers];
      }
    }

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
    const normalizedMembers = members
      .map((member) => normalizeMemberRecord(member))
      .filter((member): member is z.infer<typeof memberSchema> => Boolean(member));

    await client.query(
      `
        UPDATE teams
        SET members = $1
        WHERE id = $2
      `,
      [JSON.stringify(normalizedMembers), team.id]
    );

    if (competitionId) {
      const activeMembers = normalizedMembers.filter(
        (member) =>
          member.registered &&
          member.events.some((event) => event?.name)
      );

      await syncCompetitionRegistrations({
        client,
        userId: req.user!.id,
        teamId: team.id,
        competitionId,
        members: activeMembers
      });
    }

    await client.query('COMMIT');

    res.json({
      team: {
        id: team.id,
        name: team.name
      },
      members: normalizedMembers
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

export { teamRouter };

