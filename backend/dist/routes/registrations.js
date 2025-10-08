"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrationsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("../database/client");
const authGuard_1 = require("../middleware/authGuard");
const registrationsRouter = (0, express_1.Router)();
exports.registrationsRouter = registrationsRouter;
const registrationStatusSchema = zod_1.z.enum(['pending', 'approved', 'rejected', 'cancelled']);
const attachmentSchema = zod_1.z.object({
    fileName: zod_1.z.string().min(1),
    fileUrl: zod_1.z.string().url(),
    size: zod_1.z.number().int().positive().optional()
});
const baseParticipantSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    gender: zod_1.z.string().optional(),
    identityType: zod_1.z.string().optional(),
    contact: zod_1.z.string().optional(),
    organization: zod_1.z.string().optional(),
    teamId: zod_1.z.string().uuid().optional(),
    teamName: zod_1.z.string().optional(),
    teamMembers: zod_1.z.array(zod_1.z.string().min(1)).max(20).optional(),
    extra: zod_1.z.record(zod_1.z.unknown()).optional()
});
const registrationSchema = zod_1.z.object({
    competitionId: zod_1.z.string().uuid(),
    participant: baseParticipantSchema,
    selections: zod_1.z.object({
        events: zod_1.z.array(zod_1.z.object({
            eventId: zod_1.z.string().uuid(),
            groupId: zod_1.z.string().uuid().optional()
        })).min(1)
    }),
    attachments: zod_1.z.array(attachmentSchema).optional(),
    remark: zod_1.z.string().optional()
});
const listQuerySchema = zod_1.z.object({
    competitionId: zod_1.z.string().uuid().optional(),
    status: registrationStatusSchema.optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    pageSize: zod_1.z.coerce.number().int().min(1).max(100).default(20)
});
const updateRegistrationSchema = zod_1.z.object({
    status: registrationStatusSchema.optional(),
    remark: zod_1.z.string().optional(),
    attachments: zod_1.z.array(attachmentSchema).optional(),
    participant: zod_1.z
        .object({
        contact: zod_1.z.string().optional(),
        gender: zod_1.z.string().optional(),
        identityType: zod_1.z.string().optional(),
        organization: zod_1.z.string().optional()
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
function mapRegistrationRow(row) {
    const extra = (row.extra ?? {});
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
            organization: extra?.organization ?? null
        },
        team: row.team_id
            ? {
                id: row.team_id,
                name: row.team_name ?? extra?.teamName ?? null,
                members: teamMembers
            }
            : null,
        remark: extra?.remark ?? null,
        attachments,
        selections: selections.map((item) => ({
            eventId: item?.eventId ?? null,
            eventName: item?.eventName ?? null,
            groupId: item?.groupId ?? null,
            groupName: item?.groupName ?? null
        }))
    };
}
async function fetchRegistrationById(id) {
    const result = await client_1.pool.query(`${registrationSelectBase}
     WHERE r.id = $1
     ${registrationGroupClause}
     LIMIT 1`, [id]);
    if (result.rows.length === 0) {
        return null;
    }
    return mapRegistrationRow(result.rows[0]);
}
registrationsRouter.get('/', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const { competitionId, status, page, pageSize } = listQuerySchema.parse(req.query);
        const user = req.user;
        const filters = [];
        const params = [];
        let index = 1;
        if (user.role === 'admin') {
            // all registrations
        }
        else if (user.role === 'organizer') {
            filters.push(`c.created_by = $${index++}`);
            params.push(user.id);
        }
        else {
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
        const result = await client_1.pool.query(`${registrationSelectBase}
         ${whereSql}
         ${registrationGroupClause}
         ORDER BY r.created_at DESC
         LIMIT $${limitIndex} OFFSET $${offsetIndex}`, params);
        const registrations = result.rows.map((row) => mapRegistrationRow(row));
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
    }
    catch (error) {
        next(error);
    }
});
registrationsRouter.post('/', authGuard_1.authGuard, async (req, res, next) => {
    const client = await client_1.pool.connect();
    try {
        const payload = registrationSchema.parse(req.body);
        const user = req.user;
        await client.query('BEGIN');
        const competitionResult = await client.query(`
          SELECT id, signup_start_at, signup_end_at
          FROM competitions
          WHERE id = $1
        `, [payload.competitionId]);
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
        const eventsResult = await client.query(`
          SELECT id FROM competition_events
          WHERE competition_id = $1 AND id = ANY($2::uuid[])
        `, [payload.competitionId, eventIds]);
        if (eventsResult.rows.length !== eventIds.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: '存在无效的项目选择' });
        }
        const groupIds = payload.selections.events
            .map((selection) => selection.groupId)
            .filter((value) => Boolean(value));
        if (groupIds.length > 0) {
            const groupsResult = await client.query(`
            SELECT id FROM competition_groups
            WHERE competition_id = $1 AND id = ANY($2::uuid[])
          `, [payload.competitionId, groupIds]);
            if (groupsResult.rows.length !== groupIds.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: '存在无效的分组选择' });
            }
        }
        let teamId = null;
        if (payload.participant.teamId) {
            const teamResult = await client.query('SELECT id, user_id FROM teams WHERE id = $1', [payload.participant.teamId]);
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
        }
        else if (payload.participant.teamName) {
            const teamInsert = await client.query(`
            INSERT INTO teams (name, contact_phone, members, user_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id)
            DO UPDATE SET name = EXCLUDED.name, contact_phone = EXCLUDED.contact_phone, members = EXCLUDED.members
            RETURNING id
          `, [
                payload.participant.teamName,
                payload.participant.contact ?? null,
                JSON.stringify(payload.participant.teamMembers ?? []),
                user.id
            ]);
            teamId = teamInsert.rows[0].id;
        }
        const registrationInsert = await client.query(`
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
        `, [
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
        ]);
        const registrationId = registrationInsert.rows[0].id;
        for (const selection of payload.selections.events) {
            await client.query(`
            INSERT INTO competition_registration_events (registration_id, event_id, group_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (registration_id, event_id) DO NOTHING
          `, [registrationId, selection.eventId, selection.groupId ?? null]);
        }
        await client.query('COMMIT');
        const registration = await fetchRegistrationById(registrationId);
        res.status(201).json({ registration });
    }
    catch (error) {
        await client.query('ROLLBACK');
        next(error);
    }
    finally {
        client.release();
    }
});
registrationsRouter.patch('/:registrationId', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const registrationId = zod_1.z.string().uuid().parse(req.params.registrationId);
        const payload = updateRegistrationSchema.parse(req.body);
        const user = req.user;
        const current = await fetchRegistrationById(registrationId);
        if (!current) {
            return res.status(404).json({ message: '报名记录不存在' });
        }
        if (user.role === 'participant' && current.userId !== user.id) {
            return res.status(403).json({ message: '无权编辑该报名记录' });
        }
        if (payload.status &&
            user.role === 'participant' &&
            payload.status !== 'cancelled') {
            return res.status(403).json({ message: '仅可撤销当前报名' });
        }
        const updates = [];
        const values = [];
        let index = 1;
        if (payload.status) {
            updates.push(`status = $${index++}`);
            values.push(payload.status);
        }
        const extra = {
            organization: current.participant.organization,
            remark: current.remark
        };
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
        await client_1.pool.query(`
          UPDATE competition_registrations
          SET ${updates.join(', ')}
          WHERE id = $${index}
        `, values);
        const registration = await fetchRegistrationById(registrationId);
        res.json({ registration });
    }
    catch (error) {
        next(error);
    }
});
registrationsRouter.delete('/:registrationId', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const registrationId = zod_1.z.string().uuid().parse(req.params.registrationId);
        const user = req.user;
        const current = await fetchRegistrationById(registrationId);
        if (!current) {
            return res.status(404).json({ message: '报名记录不存在' });
        }
        if (user.role === 'participant' && current.userId !== user.id) {
            return res.status(403).json({ message: '无权撤销该报名记录' });
        }
        await client_1.pool.query(`
          UPDATE competition_registrations
          SET status = 'cancelled',
              updated_at = NOW()
          WHERE id = $1
        `, [registrationId]);
        const registration = await fetchRegistrationById(registrationId);
        res.json({ registration });
    }
    catch (error) {
        next(error);
    }
});
