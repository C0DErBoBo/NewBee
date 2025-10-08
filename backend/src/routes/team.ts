import { Router } from 'express';
import { z } from 'zod';
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

async function ensureTeam(userId: string) {
  const teamResult = await pool.query(
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

  const userResult = await pool.query(
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

  const insertResult = await pool.query(
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
  members: z.array(memberSchema)
});

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
  try {
    const team = await ensureTeam(req.user!.id);
    const { members } = membersPayloadSchema.parse(req.body);

    await pool.query(
      `
        UPDATE teams
        SET members = $1
        WHERE id = $2
      `,
      [JSON.stringify(members), team.id]
    );

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

export { teamRouter };
