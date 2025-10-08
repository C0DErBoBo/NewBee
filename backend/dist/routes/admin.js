"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const authGuard_1 = require("../middleware/authGuard");
const client_1 = require("../database/client");
const adminRouter = (0, express_1.Router)();
exports.adminRouter = adminRouter;
const ROLE_OPTIONS = ['admin', 'organizer', 'team'];
adminRouter.use(authGuard_1.authGuard);
adminRouter.use((req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: '需要管理员权限' });
    }
    next();
});
function generateRandomPassword() {
    return Math.random().toString(36).slice(-10);
}
const teamMemberSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    role: zod_1.z.string().optional(),
    age: zod_1.z.number().int().positive().optional()
});
const importSchema = zod_1.z.object({
    teams: zod_1.z
        .array(zod_1.z.object({
        name: zod_1.z.string().min(1),
        contactPhone: zod_1.z.string().optional(),
        members: zod_1.z.array(teamMemberSchema).default([])
    }))
        .min(1)
});
adminRouter.post('/teams/import', async (req, res, next) => {
    const client = await client_1.pool.connect();
    try {
        const payload = importSchema.parse(req.body);
        await client.query('BEGIN');
        const imported = [];
        for (const team of payload.teams) {
            const password = generateRandomPassword();
            const passwordHash = await bcryptjs_1.default.hash(password, 10);
            const displayName = team.name;
            const userResult = await client.query(`
            INSERT INTO users (phone, password_hash, display_name, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `, [team.contactPhone ?? null, passwordHash, displayName, 'team']);
            const userId = userResult.rows[0].id;
            const teamResult = await client.query(`
            INSERT INTO teams (name, contact_phone, members, user_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `, [team.name, team.contactPhone ?? null, team.members ?? [], userId]);
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
    }
    catch (error) {
        await client.query('ROLLBACK');
        next(error);
    }
    finally {
        client.release();
    }
});
adminRouter.get('/teams/export', async (_req, res, next) => {
    try {
        const { rows } = await client_1.pool.query(`
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
      `);
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
    }
    catch (error) {
        next(error);
    }
});
adminRouter.get('/accounts', async (_req, res, next) => {
    try {
        const { rows } = await client_1.pool.query(`
        SELECT id, phone, display_name, role, created_at
        FROM users
        ORDER BY created_at DESC
      `);
        res.json({
            accounts: rows.map((row) => ({
                id: row.id,
                phone: row.phone,
                displayName: row.display_name,
                role: row.role,
                createdAt: row.created_at
            }))
        });
    }
    catch (error) {
        next(error);
    }
});
const updateRoleSchema = zod_1.z.object({
    role: zod_1.z.enum(ROLE_OPTIONS)
});
adminRouter.patch('/accounts/:userId/role', async (req, res, next) => {
    try {
        const userId = zod_1.z.string().uuid().parse(req.params.userId);
        const { role } = updateRoleSchema.parse(req.body);
        const { rowCount, rows } = await client_1.pool.query(`
          UPDATE users
          SET role = $2
          WHERE id = $1
          RETURNING id, phone, display_name, role, created_at
        `, [userId, role]);
        if (rowCount === 0) {
            return res.status(404).json({ message: '账号不存在' });
        }
        res.json({ account: rows[0] });
    }
    catch (error) {
        next(error);
    }
});
const resetSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid()
});
adminRouter.post('/teams/reset-password', async (req, res, next) => {
    try {
        const { userId } = resetSchema.parse(req.body);
        const password = generateRandomPassword();
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const { rowCount } = await client_1.pool.query(`
          UPDATE users
          SET password_hash = $2
          WHERE id = $1 AND role = 'team'
        `, [userId, passwordHash]);
        if (rowCount === 0) {
            return res.status(404).json({ message: '队伍账号不存在' });
        }
        res.json({
            userId,
            password
        });
    }
    catch (error) {
        next(error);
    }
});
