import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/client';
import { authGuard, AuthenticatedRequest } from '../middleware/authGuard';

const registrationsRouter = Router();

const attachmentSchema = z.object({
  fileName: z.string().min(1),
  fileUrl: z.string().url(),
  size: z.number().int().positive().optional()
});

const registrationSchema = z.object({
  competitionId: z.string().uuid(),
  participant: z.object({
    name: z.string().min(1),
    gender: z.string().optional(),
    identityType: z.string().optional(),
    contact: z.string().optional(),
    organization: z.string().optional(),
    teamId: z.string().uuid().optional(),
    teamName: z.string().optional(),
    teamMembers: z.array(z.string().min(1)).max(20).optional(),
    extra: z.record(z.unknown()).optional()
  }),
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

registrationsRouter.post(
  '/',
  authGuard,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const payload = registrationSchema.parse(req.body);
      const user = req.user!;

      const competitionResult = await pool.query(
        `
          SELECT id, signup_start_at, signup_end_at
          FROM competitions
          WHERE id = $1
        `,
        [payload.competitionId]
      );

      const competition = competitionResult.rows[0];
      if (!competition) {
        return res.status(404).json({ message: '赛事不存在' });
      }

      const now = new Date();
      if (competition.signup_start_at && now < new Date(competition.signup_start_at)) {
        return res.status(400).json({ message: '报名尚未开始' });
      }
      if (competition.signup_end_at && now > new Date(competition.signup_end_at)) {
        return res.status(400).json({ message: '报名已截止' });
      }

      const eventIds = payload.selections.events.map((selection) => selection.eventId);
      const eventsResult = await pool.query(
        `
          SELECT id FROM competition_events
          WHERE competition_id = $1 AND id = ANY($2::uuid[])
        `,
        [payload.competitionId, eventIds]
      );

      if (eventsResult.rows.length !== eventIds.length) {
        return res.status(400).json({ message: '存在无效的项目选择' });
      }

      const groupIds = payload.selections.events
        .map((selection) => selection.groupId)
        .filter((value): value is string => Boolean(value));

      if (groupIds.length > 0) {
        const groupsResult = await pool.query(
          `
            SELECT id FROM competition_groups
            WHERE competition_id = $1 AND id = ANY($2::uuid[])
          `,
          [payload.competitionId, groupIds]
        );

        if (groupsResult.rows.length !== groupIds.length) {
          return res.status(400).json({ message: '存在无效的分组选择' });
        }
      }

      let teamId: string | null = null;
      if (payload.participant.teamId) {
        const teamResult = await pool.query(
          'SELECT id, user_id FROM teams WHERE id = $1',
          [payload.participant.teamId]
        );
        const team = teamResult.rows[0];
        if (!team) {
          return res.status(404).json({ message: '团队不存在' });
        }
        if (team.user_id !== user.id) {
          return res.status(403).json({ message: '无权使用该团队信息' });
        }
        teamId = team.id;
      } else if (payload.participant.teamName) {
        const teamInsert = await pool.query(
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

      const registrationInsert = await pool.query(
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
          RETURNING id, competition_id, team_id, participant_name, participant_gender,
                    participant_identity, contact, extra, attachments, status, created_at, updated_at
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
        await pool.query(
          `
            INSERT INTO competition_registration_events (registration_id, event_id, group_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (registration_id, event_id) DO NOTHING
          `,
          [registrationId, selection.eventId, selection.groupId ?? null]
        );
      }

      res.status(201).json({
        registration: {
          ...registrationInsert.rows[0],
          attachments: payload.attachments ?? [],
          selections: payload.selections.events
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

export { registrationsRouter };
