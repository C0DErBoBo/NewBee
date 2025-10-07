import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authGuard, AuthenticatedRequest } from '../middleware/authGuard';
import { pool } from '../database/client';

const adminRouter = Router();
const ROLE_OPTIONS = ['admin', 'organizer', 'team'] as const;

adminRouter.use(authGuard);

adminRouter.use((req: AuthenticatedRequest, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: '需要管理员权限' });
  }
  next();
});

function generateRandomPassword() {
  return Math.random().toString(36).slice(-10);
}

const teamMemberSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  age: z.number().int().positive().optional()
});

const importSchema = z.object({
  teams: z
    .array(
      z.object({
        name: z.string().min(1),
        contactPhone: z.string().optional(),
        members: z.array(teamMemberSchema).default([])
      })
    )
    .min(1)
});

adminRouter.post(
  '/teams/import',
  async (req: AuthenticatedRequest, res, next) => {
    const client = await pool.connect();
    try {
      const payload = importSchema.parse(req.body);
      await client.query('BEGIN');

      const imported: Array<{
        teamId: string;
        userId: string;
        name: string;
        username: string;
        password: string;
      }> = [];

      for (const team of payload.teams) {
        const password = generateRandomPassword();
        const passwordHash = await bcrypt.hash(password, 10);
        const displayName = team.name;

        const userResult = await client.query(
          `
            INSERT INTO users (phone, password_hash, display_name, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `,
          [team.contactPhone ?? null, passwordHash, displayName, 'team']
        );

        const userId = userResult.rows[0].id;

        const teamResult = await client.query(
          `
            INSERT INTO teams (name, contact_phone, members, user_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `,
          [team.name, team.contactPhone ?? null, team.members ?? [], userId]
        );

        imported.push({
          teamId: teamResult.rows[0].id,
          userId,
          name: team.name,
          username: team.contactPhone ?? userId,
          password
        });
      }

      await client.query('COMMIT');

      res.status(201).json({ teams: imported });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

adminRouter.get('/teams/export', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          t.id,
          t.name,
          t.contact_phone,
          t.members,
          u.id AS user_id,
          u.display_name,
          u.phone
        FROM teams t
        JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC
      `
    );

    res.json({
      teams: rows.map((row) => ({
        teamId: row.id,
        name: row.name,
        contactPhone: row.contact_phone,
        members: row.members ?? [],
        account: {
          userId: row.user_id,
          displayName: row.display_name,
          phone: row.phone
        }
      }))
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/accounts', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, phone, display_name, role, created_at
        FROM users
        ORDER BY created_at DESC
      `
    );
    res.json({
      accounts: rows.map((row) => ({
        id: row.id,
        phone: row.phone,
        displayName: row.display_name,
        role: row.role,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

const updateRoleSchema = z.object({
  role: z.enum(ROLE_OPTIONS)
});

adminRouter.patch(
  '/accounts/:userId/role',
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = z.string().uuid().parse(req.params.userId);
      const { role } = updateRoleSchema.parse(req.body);

      const { rowCount, rows } = await pool.query(
        `
          UPDATE users
          SET role = $2
          WHERE id = $1
          RETURNING id, phone, display_name, role, created_at
        `,
        [userId, role]
      );

      if (rowCount === 0) {
        return res.status(404).json({ message: '账号不存在' });
      }

      res.json({ account: rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

const resetSchema = z.object({
  userId: z.string().uuid()
});

adminRouter.post(
  '/teams/reset-password',
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { userId } = resetSchema.parse(req.body);
      const password = generateRandomPassword();
      const passwordHash = await bcrypt.hash(password, 10);

      const { rowCount } = await pool.query(
        `
          UPDATE users
          SET password_hash = $2
          WHERE id = $1 AND role = 'team'
        `,
        [userId, passwordHash]
      );

      if (rowCount === 0) {
        return res.status(404).json({ message: '队伍账号不存在' });
      }

      res.json({
        userId,
        password
      });
    } catch (error) {
      next(error);
    }
  }
);

export { adminRouter };
