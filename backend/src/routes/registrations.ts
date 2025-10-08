import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/client';
import { authGuard, AuthenticatedRequest } from '../middleware/authGuard';

const registrationsRouter = Router();

const registrationStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled']);

const attachmentSchema = z.object({
  fileName: z.string().min(1),
  fileUrl: z.string().url(),
  size: z.number().int().positive().optional()
});

const baseParticipantSchema = z.object({
  name: z.string().min(1),
  gender: z.string().optional(),
  identityType: z.string().optional(),
  contact: z.string().optional(),
  organization: z.string().optional(),
  teamId: z.string().uuid().optional(),
  teamName: z.string().optional(),
  teamMembers: z.array(z.string().min(1)).max(20).optional(),
  extra: z.record(z.unknown()).optional()
});

const registrationSchema = z.object({
  competitionId: z.string().uuid(),
  participant: baseParticipantSchema,
  selections: z.object({
    events: z.array(
      z.object({
        eventId: z.string().uuid(),
        groupId: z.string().uuid().optional()
      })
    ).min(1)
  }),
  attachments: z.array(attachmentSchema).optional(),
  remark: z.string().optional()
});

const listQuerySchema = z.object({
  competitionId: z.string().uuid().optional(),
  status: registrationStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

const updateRegistrationSchema = z.object({
  status: registrationStatusSchema.optional(),
  remark: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  participant: z
    .object({
      contact: z.string().optional(),
      gender: z.string().optional(),
      identityType: z.string().optional(),
      organization: z.string().optional()
    })
    .optional()
});

const registrationSelectBase = `
  SELECT
    r.id,
    r.competition_id,
    c.name AS competition_name,
    r.user_id,
    r.team_id,
    t.name AS team_name,
    t.members AS team_members,
    r.participant_name,
    r.participant_gender,
    r.participant_identity,
    r.contact,
    r.extra,
    r.attachments,
    r.status,
    r.created_at,
    r.updated_at,
    COUNT(*) OVER() AS total_rows,
    COALESCE(
      json_agg(
        json_build_object(
          'eventId', e.id,
          'eventName', e.name,
          'groupId', g.id,
          'groupName', g.name
        )
      ) FILTER (WHERE e.id IS NOT NULL),
      '[]'::json
    ) AS selections
  FROM competition_registrations r
  JOIN competitions c ON r.competition_id = c.id
  LEFT JOIN teams t ON r.team_id = t.id
  LEFT JOIN competition_registration_events cre ON cre.registration_id = r.id
  LEFT JOIN competition_events e ON cre.event_id = e.id
  LEFT JOIN competition_groups g ON cre.group_id = g.id
`;

const registrationGroupClause = 'GROUP BY r.id, c.name, t.name, t.members';

type RegistrationRow = {
  id: string;
  competition_id: string;
  competition_name: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  team_members: unknown;
  participant_name: string;
  participant_gender: string | null;
  participant_identity: string | null;
  contact: string | null;
  extra: unknown;
  attachments: unknown;
  status: string;
  created_at: string;
  updated_at: string;
  selections: unknown;
  total_rows?: number;
};

function mapRegistrationRow(row: RegistrationRow) {
  const extra = (row.extra ?? {}) as Record<string, unknown>;
  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  const selections = Array.isArray(row.selections) ? row.selections : [];
  const teamMembers = Array.isArray(row.team_members) ? row.team_members : [];

  return {
    id: row.id,
    competitionId: row.competition_id,
    competitionName: row.competition_name,
    userId: row.user_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participant: {
      name: row.participant_name,
      gender: row.participant_gender ?? null,
      identityType: row.participant_identity ?? null,
      contact: row.contact ?? null,
      organization: (extra?.organization as string | null) ?? null
    },
    team: row.team_id
      ? {
          id: row.team_id,
          name: row.team_name ?? (extra?.teamName as string | null) ?? null,
          members: teamMembers
        }
      : null,
    remark: (extra?.remark as string | null) ?? null,
    attachments,
    selections: selections.map((item: any) => ({
      eventId: item?.eventId ?? null,
      eventName: item?.eventName ?? null,
      groupId: item?.groupId ?? null,
      groupName: item?.groupName ?? null
    }))
  };
}

async function fetchRegistrationById(id: string) {
  const result = await pool.query(
    `${registrationSelectBase}
     WHERE r.id = $1
     ${registrationGroupClause}
     LIMIT 1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRegistrationRow(result.rows[0] as RegistrationRow);
}

registrationsRouter.get(
  '/',
  authGuard,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { competitionId, status, page, pageSize } = listQuerySchema.parse(req.query);
      const user = req.user!;

      const filters: string[] = [];
      const params: unknown[] = [];
      let index = 1;

      if (user.role === 'admin') {
        // all registrations
      } else if (user.role === 'organizer') {
        filters.push(`c.created_by = $${index++}`);
        params.push(user.id);
      } else {
        filters.push(`r.user_id = $${index++}`);
        params.push(user.id);
      }

      if (competitionId) {
        filters.push(`r.competition_id = $${index++}`);
        params.push(competitionId);
      }

      if (status) {
        filters.push(`r.status = $${index++}`);
        params.push(status);
      }

      const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const limitIndex = index++;
      params.push(pageSize);
      const offsetIndex = index++;
      params.push((page - 1) * pageSize);

      const result = await pool.query(
        `${registrationSelectBase}
         ${whereSql}
         ${registrationGroupClause}
         ORDER BY r.created_at DESC
         LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        params
      );

      const registrations = result.rows.map((row) => mapRegistrationRow(row as RegistrationRow));
      const total = result.rows.length
        ? Number(result.rows[0].total_rows ?? result.rows.length)
        : 0;

      res.json({
        registrations,
        pagination: {
          page,
          pageSize,
          total
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

registrationsRouter.post(
  '/',
  authGuard,
  async (req: AuthenticatedRequest, res, next) => {
    const client = await pool.connect();
    try {
      const payload = registrationSchema.parse(req.body);
      const user = req.user!;

      await client.query('BEGIN');

      const competitionResult = await client.query(
        `
          SELECT id, signup_start_at, signup_end_at
          FROM competitions
          WHERE id = $1
        `,
        [payload.competitionId]
      );

      const competition = competitionResult.rows[0];
      if (!competition) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: '赛事不存在' });
      }

      const now = new Date();
      if (competition.signup_start_at && now < new Date(competition.signup_start_at)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: '报名尚未开始' });
      }
      if (competition.signup_end_at && now > new Date(competition.signup_end_at)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: '报名已截止' });
      }

      const eventIds = payload.selections.events.map((selection) => selection.eventId);
      const eventsResult = await client.query(
        `
          SELECT id FROM competition_events
          WHERE competition_id = $1 AND id = ANY($2::uuid[])
        `,
        [payload.competitionId, eventIds]
      );

      if (eventsResult.rows.length !== eventIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: '存在无效的项目选择' });
      }

      const groupIds = payload.selections.events
        .map((selection) => selection.groupId)
        .filter((value): value is string => Boolean(value));

      if (groupIds.length > 0) {
        const groupsResult = await client.query(
          `
            SELECT id FROM competition_groups
            WHERE competition_id = $1 AND id = ANY($2::uuid[])
          `,
          [payload.competitionId, groupIds]
        );

        if (groupsResult.rows.length !== groupIds.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: '存在无效的分组选择' });
        }
      }

      let teamId: string | null = null;
      if (payload.participant.teamId) {
        const teamResult = await client.query(
          'SELECT id, user_id FROM teams WHERE id = $1',
          [payload.participant.teamId]
        );
        const team = teamResult.rows[0];
        if (!team) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: '团队不存在' });
        }
        if (team.user_id !== user.id) {
          await client.query('ROLLBACK');
          return res.status(403).json({ message: '无权使用该团队信息' });
        }
        teamId = team.id;
      } else if (payload.participant.teamName) {
        const teamInsert = await client.query(
          `
            INSERT INTO teams (name, contact_phone, members, user_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id)
            DO UPDATE SET name = EXCLUDED.name, contact_phone = EXCLUDED.contact_phone, members = EXCLUDED.members
            RETURNING id
          `,
          [
            payload.participant.teamName,
            payload.participant.contact ?? null,
            JSON.stringify(payload.participant.teamMembers ?? []),
            user.id
          ]
        );
        teamId = teamInsert.rows[0].id;
      }

      const registrationInsert = await client.query(
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
          RETURNING id
        `,
        [
          payload.competitionId,
          user.id,
          teamId,
          payload.participant.name,
          payload.participant.gender ?? null,
          payload.participant.identityType ?? null,
          payload.participant.contact ?? null,
          JSON.stringify({
            organization: payload.participant.organization ?? null,
            participantExtra: payload.participant.extra ?? {},
            remark: payload.remark ?? null
          }),
          JSON.stringify(payload.attachments ?? [])
        ]
      );

      const registrationId = registrationInsert.rows[0].id as string;

      for (const selection of payload.selections.events) {
        await client.query(
          `
            INSERT INTO competition_registration_events (registration_id, event_id, group_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (registration_id, event_id) DO NOTHING
          `,
          [registrationId, selection.eventId, selection.groupId ?? null]
        );
      }

      await client.query('COMMIT');

      const registration = await fetchRegistrationById(registrationId);
      res.status(201).json({ registration });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

registrationsRouter.patch(
  '/:registrationId',
  authGuard,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const registrationId = z.string().uuid().parse(req.params.registrationId);
      const payload = updateRegistrationSchema.parse(req.body);
      const user = req.user!;

      const current = await fetchRegistrationById(registrationId);
      if (!current) {
        return res.status(404).json({ message: '报名记录不存在' });
      }

      if (user.role === 'participant' && current.userId !== user.id) {
        return res.status(403).json({ message: '无权编辑该报名记录' });
      }

      if (
        payload.status &&
        user.role === 'participant' &&
        payload.status !== 'cancelled'
      ) {
        return res.status(403).json({ message: '仅可撤销当前报名' });
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      let index = 1;

      if (payload.status) {
        updates.push(`status = $${index++}`);
        values.push(payload.status);
      }

      const extra = {
        organization: current.participant.organization,
        remark: current.remark
      } as Record<string, unknown>;

      if (payload.remark !== undefined) {
        extra.remark = payload.remark;
        updates.push(`extra = $${index++}`);
        values.push(JSON.stringify(extra));
      }

      if (payload.attachments) {
        updates.push(`attachments = $${index++}`);
        values.push(JSON.stringify(payload.attachments));
      }

      if (payload.participant?.contact !== undefined) {
        updates.push(`contact = $${index++}`);
        values.push(payload.participant.contact ?? null);
      }

      if (payload.participant?.gender !== undefined) {
        updates.push(`participant_gender = $${index++}`);
        values.push(payload.participant.gender ?? null);
      }

      if (payload.participant?.identityType !== undefined) {
        updates.push(`participant_identity = $${index++}`);
        values.push(payload.participant.identityType ?? null);
      }

      if (!updates.length) {
        const registration = await fetchRegistrationById(registrationId);
        return res.json({ registration });
      }

      updates.push('updated_at = NOW()');
      values.push(registrationId);

      await pool.query(
        `
          UPDATE competition_registrations
          SET ${updates.join(', ')}
          WHERE id = $${index}
        `,
        values
      );

      const registration = await fetchRegistrationById(registrationId);
      res.json({ registration });
    } catch (error) {
      next(error);
    }
  }
);

registrationsRouter.delete(
  '/:registrationId',
  authGuard,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const registrationId = z.string().uuid().parse(req.params.registrationId);
      const user = req.user!;

      const current = await fetchRegistrationById(registrationId);
      if (!current) {
        return res.status(404).json({ message: '报名记录不存在' });
      }

      if (user.role === 'participant' && current.userId !== user.id) {
        return res.status(403).json({ message: '无权撤销该报名记录' });
      }

      await pool.query(
        `
          UPDATE competition_registrations
          SET status = 'cancelled',
              updated_at = NOW()
          WHERE id = $1
        `,
        [registrationId]
      );

      const registration = await fetchRegistrationById(registrationId);
      res.json({ registration });
    } catch (error) {
      next(error);
    }
  }
);
