"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.competitionRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("../database/client");
const authGuard_1 = require("../middleware/authGuard");
const competitionRouter = (0, express_1.Router)();
exports.competitionRouter = competitionRouter;
const standardEvents = [
    { name: '100m', category: 'track', unitType: 'individual' },
    { name: '200m', category: 'track', unitType: 'individual' },
    { name: '400m', category: 'track', unitType: 'individual' },
    { name: '800m', category: 'track', unitType: 'individual' },
    { name: '1500m', category: 'track', unitType: 'individual' },
    { name: '4x100m 接力', category: 'track', unitType: 'team' },
    { name: '跳远', category: 'field', unitType: 'individual' },
    { name: '三级跳', category: 'field', unitType: 'individual' },
    { name: '铅球', category: 'field', unitType: 'individual' },
    { name: '铁饼', category: 'field', unitType: 'individual' }
];
const eventSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    category: zod_1.z.enum(['track', 'field']),
    unitType: zod_1.z.enum(['individual', 'team']),
    isCustom: zod_1.z.boolean().default(false).optional(),
    config: zod_1.z.record(zod_1.z.unknown()).default({}).optional()
});
const groupSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    gender: zod_1.z.enum(['male', 'female', 'mixed']),
    ageBracket: zod_1.z.string().optional(),
    identityType: zod_1.z.string().optional(),
    maxParticipants: zod_1.z.number().int().positive().optional(),
    teamSize: zod_1.z.number().int().positive().optional(),
    config: zod_1.z.record(zod_1.z.unknown()).default({}).optional()
});
const ruleSchema = zod_1.z.object({
    scoring: zod_1.z.record(zod_1.z.unknown()).default({}).optional(),
    flow: zod_1.z.record(zod_1.z.unknown()).default({}).optional(),
    penalties: zod_1.z.record(zod_1.z.unknown()).default({}).optional()
});
const createCompetitionSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    location: zod_1.z.string().optional(),
    signupStartAt: zod_1.z.string().datetime(),
    signupEndAt: zod_1.z.string().datetime(),
    startAt: zod_1.z.string().datetime().optional(),
    endAt: zod_1.z.string().datetime().optional(),
    config: zod_1.z.record(zod_1.z.unknown()).default({}).optional(),
    events: zod_1.z.array(eventSchema).optional(),
    groups: zod_1.z.array(groupSchema).optional(),
    rules: ruleSchema.optional()
});
const updateCompetitionSchema = createCompetitionSchema.partial();
async function fetchCompetition(competitionId) {
    const competitionResult = await client_1.pool.query(`
      SELECT id,
             name,
             location,
             start_at,
             end_at,
             signup_start_at,
             signup_end_at,
             config,
             created_by,
             created_at,
             0::INT AS participant_count,
             0::INT AS team_count
      FROM competitions
      WHERE id = $1
    `, [competitionId]);
    const competition = competitionResult.rows[0];
    if (!competition) {
        return null;
    }
    const [eventsResult, groupsResult, rulesResult] = await Promise.all([
        client_1.pool.query(`
        SELECT id, competition_id, name, category, unit_type, is_custom, config, created_at
        FROM competition_events
        WHERE competition_id = $1
        ORDER BY created_at
      `, [competitionId]),
        client_1.pool.query(`
        SELECT id, competition_id, name, gender, age_bracket, identity_type,
               max_participants, team_size, config, created_at
        FROM competition_groups
        WHERE competition_id = $1
        ORDER BY created_at
      `, [competitionId]),
        client_1.pool.query(`
        SELECT competition_id, scoring, flow, penalties, created_at, updated_at
        FROM competition_rules
        WHERE competition_id = $1
      `, [competitionId])
    ]);
    return {
        id: competition.id,
        name: competition.name,
        location: competition.location,
        startAt: competition.start_at,
        endAt: competition.end_at,
        config: competition.config ?? {},
        signupStartAt: competition.signup_start_at,
        signupEndAt: competition.signup_end_at,
        createdBy: competition.created_by,
        createdAt: competition.created_at,
        stats: {
            participantCount: competition.participant_count ?? 0,
            teamCount: competition.team_count ?? 0
        },
        events: eventsResult.rows.map((row) => ({
            id: row.id,
            name: row.name,
            category: row.category,
            unitType: row.unit_type,
            isCustom: row.is_custom,
            config: row.config ?? {},
            createdAt: row.created_at
        })),
        groups: groupsResult.rows.map((row) => ({
            id: row.id,
            name: row.name,
            gender: row.gender,
            ageBracket: row.age_bracket,
            identityType: row.identity_type,
            maxParticipants: row.max_participants,
            teamSize: row.team_size,
            config: row.config ?? {},
            createdAt: row.created_at
        })),
        rules: rulesResult.rows[0]
            ? {
                scoring: rulesResult.rows[0].scoring ?? {},
                flow: rulesResult.rows[0].flow ?? {},
                penalties: rulesResult.rows[0].penalties ?? {},
                createdAt: rulesResult.rows[0].created_at,
                updatedAt: rulesResult.rows[0].updated_at
            }
            : null
    };
}
async function ensureCompetitionOwnership(competitionId, user) {
    if (user.role === 'admin') {
        return;
    }
    const { rows } = await client_1.pool.query('SELECT created_by FROM competitions WHERE id = $1 LIMIT 1', [competitionId]);
    const competition = rows[0];
    if (!competition) {
        const error = new Error('赛事不存在');
        error.statusCode = 404;
        throw error;
    }
    if (competition.created_by !== user.id) {
        const error = new Error('无权操作该赛事');
        error.statusCode = 403;
        throw error;
    }
}
competitionRouter.get('/templates/events', (_req, res) => {
    res.json({ events: standardEvents });
});
competitionRouter.get('/', authGuard_1.authGuard, async (_req, res, next) => {
    try {
        const { rows } = await client_1.pool.query(`
        SELECT id,
               name,
               location,
               start_at,
               end_at,
               signup_start_at,
               signup_end_at,
               created_by,
               created_at,
               0::INT AS participant_count,
               0::INT AS team_count
        FROM competitions
        ORDER BY created_at DESC
      `);
        res.json({
            competitions: rows.map((row) => ({
                id: row.id,
                name: row.name,
                location: row.location,
                startAt: row.start_at,
                endAt: row.end_at,
                signupStartAt: row.signup_start_at,
                signupEndAt: row.signup_end_at,
                createdBy: row.created_by,
                createdAt: row.created_at,
                stats: {
                    participantCount: row.participant_count ?? 0,
                    teamCount: row.team_count ?? 0
                }
            }))
        });
    }
    catch (error) {
        next(error);
    }
});
competitionRouter.post('/', authGuard_1.authGuard, async (req, res, next) => {
    const client = await client_1.pool.connect();
    try {
        const payload = createCompetitionSchema.parse(req.body);
        await client.query('BEGIN');
        const competitionResult = await client.query(`
          INSERT INTO competitions
            (name, location, start_at, end_at, signup_start_at, signup_end_at, config, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [
            payload.name,
            payload.location ?? null,
            payload.startAt ?? null,
            payload.endAt ?? null,
            payload.signupStartAt,
            payload.signupEndAt,
            payload.config ?? {},
            req.user.id
        ]);
        const competitionId = competitionResult.rows[0].id;
        if (payload.events?.length) {
            for (const event of payload.events) {
                await client.query(`
              INSERT INTO competition_events (competition_id, name, category, unit_type, is_custom, config)
              VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                    competitionId,
                    event.name,
                    event.category,
                    event.unitType,
                    event.isCustom ?? false,
                    event.config ?? {}
                ]);
            }
        }
        if (payload.groups?.length) {
            for (const group of payload.groups) {
                await client.query(`
              INSERT INTO competition_groups
                (competition_id, name, gender, age_bracket, identity_type, max_participants, team_size, config)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                    competitionId,
                    group.name,
                    group.gender,
                    group.ageBracket ?? null,
                    group.identityType ?? null,
                    group.maxParticipants ?? null,
                    group.teamSize ?? null,
                    group.config ?? {}
                ]);
            }
        }
        if (payload.rules) {
            await client.query(`
            INSERT INTO competition_rules (competition_id, scoring, flow, penalties)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (competition_id)
            DO UPDATE SET scoring = EXCLUDED.scoring,
                          flow = EXCLUDED.flow,
                          penalties = EXCLUDED.penalties,
                          updated_at = NOW()
          `, [
                competitionId,
                payload.rules.scoring ?? {},
                payload.rules.flow ?? {},
                payload.rules.penalties ?? {}
            ]);
        }
        await client.query('COMMIT');
        const competition = await fetchCompetition(competitionId);
        res.status(201).json({ competition });
    }
    catch (error) {
        await client.query('ROLLBACK');
        next(error);
    }
    finally {
        client.release();
    }
});
competitionRouter.get('/:competitionId', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const id = zod_1.z.string().uuid().parse(req.params.competitionId);
        const competition = await fetchCompetition(id);
        if (!competition) {
            return res.status(404).json({ message: '赛事不存在' });
        }
        res.json({ competition });
    }
    catch (error) {
        next(error);
    }
});
competitionRouter.patch('/:competitionId', authGuard_1.authGuard, async (req, res, next) => {
    const client = await client_1.pool.connect();
    try {
        const competitionId = zod_1.z.string().uuid().parse(req.params.competitionId);
        await ensureCompetitionOwnership(competitionId, req.user);
        const payload = updateCompetitionSchema.parse(req.body);
        await client.query('BEGIN');
        if (payload.name ||
            payload.location ||
            payload.startAt ||
            payload.endAt ||
            payload.config) {
            await client.query(`
            UPDATE competitions
            SET name = COALESCE($2, name),
                location = COALESCE($3, location),
                start_at = COALESCE($4, start_at),
                end_at = COALESCE($5, end_at),
                signup_start_at = COALESCE($6, signup_start_at),
                signup_end_at = COALESCE($7, signup_end_at),
                config = COALESCE($8, config)
            WHERE id = $1
          `, [
                competitionId,
                payload.name ?? null,
                payload.location ?? null,
                payload.startAt ?? null,
                payload.endAt ?? null,
                payload.signupStartAt ?? null,
                payload.signupEndAt ?? null,
                payload.config ?? null
            ]);
        }
        if (payload.events) {
            await client.query('DELETE FROM competition_events WHERE competition_id = $1', [competitionId]);
            for (const event of payload.events) {
                await client.query(`
              INSERT INTO competition_events (competition_id, name, category, unit_type, is_custom, config)
              VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                    competitionId,
                    event.name,
                    event.category,
                    event.unitType,
                    event.isCustom ?? false,
                    event.config ?? {}
                ]);
            }
        }
        if (payload.groups) {
            await client.query('DELETE FROM competition_groups WHERE competition_id = $1', [competitionId]);
            for (const group of payload.groups) {
                await client.query(`
              INSERT INTO competition_groups
                (competition_id, name, gender, age_bracket, identity_type, max_participants, team_size, config)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                    competitionId,
                    group.name,
                    group.gender,
                    group.ageBracket ?? null,
                    group.identityType ?? null,
                    group.maxParticipants ?? null,
                    group.teamSize ?? null,
                    group.config ?? {}
                ]);
            }
        }
        if (payload.rules) {
            await client.query(`
            INSERT INTO competition_rules (competition_id, scoring, flow, penalties)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (competition_id)
            DO UPDATE SET scoring = EXCLUDED.scoring,
                          flow = EXCLUDED.flow,
                          penalties = EXCLUDED.penalties,
                          updated_at = NOW()
          `, [
                competitionId,
                payload.rules.scoring ?? {},
                payload.rules.flow ?? {},
                payload.rules.penalties ?? {}
            ]);
        }
        await client.query('COMMIT');
        const competition = await fetchCompetition(competitionId);
        res.json({ competition });
    }
    catch (error) {
        await client.query('ROLLBACK');
        next(error);
    }
    finally {
        client.release();
    }
});
competitionRouter.post('/:competitionId/events', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const competitionId = zod_1.z.string().uuid().parse(req.params.competitionId);
        await ensureCompetitionOwnership(competitionId, req.user);
        const payload = eventSchema.parse(req.body);
        const result = await client_1.pool.query(`
        INSERT INTO competition_events (competition_id, name, category, unit_type, is_custom, config)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, competition_id, name, category, unit_type, is_custom, config, created_at
        `, [
            competitionId,
            payload.name,
            payload.category,
            payload.unitType,
            payload.isCustom ?? false,
            payload.config ?? {}
        ]);
        res.status(201).json({ event: result.rows[0] });
    }
    catch (error) {
        next(error);
    }
});
competitionRouter.patch('/:competitionId/events/:eventId', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const competitionId = zod_1.z.string().uuid().parse(req.params.competitionId);
        await ensureCompetitionOwnership(competitionId, req.user);
        const eventId = zod_1.z.string().uuid().parse(req.params.eventId);
        const payload = eventSchema.partial().parse(req.body);
        const { rowCount, rows } = await client_1.pool.query(`
          UPDATE competition_events
          SET name = COALESCE($3, name),
              category = COALESCE($4, category),
              unit_type = COALESCE($5, unit_type),
              is_custom = COALESCE($6, is_custom),
              config = COALESCE($7, config)
          WHERE id = $1 AND competition_id = $2
          RETURNING id, competition_id, name, category, unit_type, is_custom, config, created_at
        `, [
            eventId,
            competitionId,
            payload.name ?? null,
            payload.category ?? null,
            payload.unitType ?? null,
            payload.isCustom ?? null,
            payload.config ?? null
        ]);
        if (rowCount === 0) {
            return res.status(404).json({ message: '项目不存在' });
        }
        res.json({ event: rows[0] });
    }
    catch (error) {
        next(error);
    }
});
competitionRouter.delete('/:competitionId/events/:eventId', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const competitionId = zod_1.z.string().uuid().parse(req.params.competitionId);
        await ensureCompetitionOwnership(competitionId, req.user);
        const eventId = zod_1.z.string().uuid().parse(req.params.eventId);
        const { rowCount } = await client_1.pool.query(`
          DELETE FROM competition_events
          WHERE id = $1 AND competition_id = $2
        `, [eventId, competitionId]);
        if (rowCount === 0) {
            return res.status(404).json({ message: '项目不存在' });
        }
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
competitionRouter.post('/:competitionId/groups', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const competitionId = zod_1.z.string().uuid().parse(req.params.competitionId);
        await ensureCompetitionOwnership(competitionId, req.user);
        const payload = groupSchema.parse(req.body);
        const result = await client_1.pool.query(`
          INSERT INTO competition_groups
            (competition_id, name, gender, age_bracket, identity_type, max_participants, team_size, config)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, competition_id, name, gender, age_bracket, identity_type,
                    max_participants, team_size, config, created_at
        `, [
            competitionId,
            payload.name,
            payload.gender,
            payload.ageBracket ?? null,
            payload.identityType ?? null,
            payload.maxParticipants ?? null,
            payload.teamSize ?? null,
            payload.config ?? {}
        ]);
        res.status(201).json({ group: result.rows[0] });
    }
    catch (error) {
        next(error);
    }
});
competitionRouter.patch('/:competitionId/groups/:groupId', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const competitionId = zod_1.z.string().uuid().parse(req.params.competitionId);
        await ensureCompetitionOwnership(competitionId, req.user);
        const groupId = zod_1.z.string().uuid().parse(req.params.groupId);
        const payload = groupSchema.partial().parse(req.body);
        const { rowCount, rows } = await client_1.pool.query(`
          UPDATE competition_groups
          SET name = COALESCE($3, name),
              gender = COALESCE($4, gender),
              age_bracket = COALESCE($5, age_bracket),
              identity_type = COALESCE($6, identity_type),
              max_participants = COALESCE($7, max_participants),
              team_size = COALESCE($8, team_size),
              config = COALESCE($9, config)
          WHERE id = $1 AND competition_id = $2
          RETURNING id, competition_id, name, gender, age_bracket, identity_type,
                    max_participants, team_size, config, created_at
        `, [
            groupId,
            competitionId,
            payload.name ?? null,
            payload.gender ?? null,
            payload.ageBracket ?? null,
            payload.identityType ?? null,
            payload.maxParticipants ?? null,
            payload.teamSize ?? null,
            payload.config ?? null
        ]);
        if (rowCount === 0) {
            return res.status(404).json({ message: '分组不存在' });
        }
        res.json({ group: rows[0] });
    }
    catch (error) {
        next(error);
    }
});
competitionRouter.delete('/:competitionId/groups/:groupId', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const competitionId = zod_1.z.string().uuid().parse(req.params.competitionId);
        await ensureCompetitionOwnership(competitionId, req.user);
        const groupId = zod_1.z.string().uuid().parse(req.params.groupId);
        const { rowCount } = await client_1.pool.query(`
          DELETE FROM competition_groups
          WHERE id = $1 AND competition_id = $2
        `, [groupId, competitionId]);
        if (rowCount === 0) {
            return res.status(404).json({ message: '分组不存在' });
        }
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
competitionRouter.put('/:competitionId/rules', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const competitionId = zod_1.z.string().uuid().parse(req.params.competitionId);
        await ensureCompetitionOwnership(competitionId, req.user);
        const payload = ruleSchema.parse(req.body);
        await client_1.pool.query(`
          INSERT INTO competition_rules (competition_id, scoring, flow, penalties)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (competition_id)
          DO UPDATE SET scoring = EXCLUDED.scoring,
                        flow = EXCLUDED.flow,
                        penalties = EXCLUDED.penalties,
                        updated_at = NOW()
        `, [
            competitionId,
            payload.scoring ?? {},
            payload.flow ?? {},
            payload.penalties ?? {}
        ]);
        const competition = await fetchCompetition(competitionId);
        res.json({ competition });
    }
    catch (error) {
        next(error);
    }
});
