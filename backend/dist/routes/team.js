"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.teamRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const database_client_1 = require("../database/client");
const authGuard_1 = require("../middleware/authGuard");
const teamRouter = (0, express_1.Router)();
exports.teamRouter = teamRouter;
teamRouter.use(authGuard_1.authGuard);
teamRouter.use((req, res, next) => {
    var _a;
    if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'team') {
        return res.status(403).json({ message: '仅限队伍账号访问' });
    }
    next();
});
async function ensureTeam(userId, client = database_client_1.pool) {
    const teamResult = await client.query(`
      SELECT id, name, members
      FROM teams
      WHERE user_id = $1
      LIMIT 1
    `, [userId]);
    if (teamResult.rows.length > 0) {
        return teamResult.rows[0];
    }
    const userResult = await client.query(`
      SELECT phone, display_name
      FROM users
      WHERE id = $1
      LIMIT 1
    `, [userId]);
    const userRow = userResult.rows[0];
    const defaultName = (userRow === null || userRow === void 0 ? void 0 : userRow.display_name) || (userRow === null || userRow === void 0 ? void 0 : userRow.phone) || '未命名队伍';
    const insertResult = await client.query(`
      INSERT INTO teams (name, contact_phone, members, user_id)
      VALUES ($1, $2, '[]', $3)
      RETURNING id, name, members
    `, [defaultName, (userRow === null || userRow === void 0 ? void 0 : userRow.phone) || null, userId]);
    return insertResult.rows[0];
}
const eventSchema = zod_1.z.object({
    name: zod_1.z.string().trim().max(100).optional().nullable(),
    result: zod_1.z.string().trim().max(100).optional().nullable()
});
const memberSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1),
    gender: zod_1.z.string().trim().max(50).optional().nullable(),
    group: zod_1.z.string().trim().max(100).optional().nullable(),
    events: zod_1.z.array(eventSchema).max(5).default([])
});
const membersPayloadSchema = zod_1.z.object({
    members: zod_1.z.array(memberSchema),
    competitionId: zod_1.z.string().uuid().optional()
});
async function syncCompetitionRegistrations(options) {
    const { client, userId, teamId, competitionId, members } = options;
    const eventsResult = await client.query(`
      SELECT id, name
      FROM competition_events
      WHERE competition_id = $1
    `, [competitionId]);
    const eventMap = new Map();
    eventsResult.rows.forEach((row) => {
        if (row.name) {
            eventMap.set(String(row.name).trim(), row.id);
        }
    });
    const existingRegistrationsResult = await client.query(`
      SELECT id, participant_name, status
      FROM competition_registrations
      WHERE competition_id = $1
        AND team_id = $2
    `, [competitionId, teamId]);
    const existingMap = new Map();
    existingRegistrationsResult.rows.forEach((row) => {
        if (row.participant_name) {
            existingMap.set(String(row.participant_name).trim(), {
                id: row.id,
                status: row.status
            });
        }
    });
    const processedIds = new Set();
    for (const member of members) {
        const participantName = member.name.trim();
        if (!participantName) {
            continue;
        }
        const eventIds = (member.events || [])
            .map((event) => (event === null || event === void 0 ? void 0 : event.name) ? eventMap.get(event.name.trim()) : undefined)
            .filter((value) => Boolean(value));
        if (!eventIds.length) {
            continue;
        }
        const existing = existingMap.get(participantName);
        let registrationId;
        if (existing) {
            await client.query(`
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
        `, [member.gender || null, member.group || null, existing.id]);
        if (existing.status === 'cancelled') {
            await client.query(`
            UPDATE competition_registrations
            SET status = 'approved', updated_at = NOW()
            WHERE id = $1
          `, [existing.id]);
        }
            registrationId = existing.id;
        }
        else {
            const insertResult = await client.query(`
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
        `, [competitionId, userId, teamId, participantName, member.gender || null, member.group || null]);
            registrationId = insertResult.rows[0].id;
        }
        processedIds.add(registrationId);
        await client.query(`DELETE FROM competition_registration_events WHERE registration_id = $1`, [registrationId]);
        for (const eventId of eventIds) {
            await client.query(`
          INSERT INTO competition_registration_events (registration_id, event_id)
          VALUES ($1, $2)
          ON CONFLICT (registration_id, event_id) DO NOTHING
        `, [registrationId, eventId]);
        }
    }
    for (const row of existingRegistrationsResult.rows) {
        const registrationId = row.id;
        if (!processedIds.has(registrationId) && row.status !== 'cancelled') {
            await client.query(`
          UPDATE competition_registrations
          SET status = 'cancelled', updated_at = NOW()
          WHERE id = $1
        `, [registrationId]);
        }
    }
}
teamRouter.get('/members', async (req, res, next) => {
    try {
        const team = await ensureTeam(req.user.id);
        const members = Array.isArray(team.members) ? team.members : [];
        res.json({
            team: {
                id: team.id,
                name: team.name
            },
            members
        });
    }
    catch (error) {
        next(error);
    }
});
teamRouter.put('/members', async (req, res, next) => {
    const client = await database_client_1.pool.connect();
    try {
        await client.query('BEGIN');
        const team = await ensureTeam(req.user.id, client);
        const { members, competitionId } = membersPayloadSchema.parse(req.body);
        await client.query(`
        UPDATE teams
        SET members = $1
        WHERE id = $2
      `, [JSON.stringify(members), team.id]);
        if (competitionId) {
            await syncCompetitionRegistrations({
                client,
                userId: req.user.id,
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
    }
    catch (error) {
        await client.query('ROLLBACK');
        next(error);
    }
    finally {
        client.release();
    }
});
