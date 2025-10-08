"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("../database/client");
const env_1 = require("../config/env");
const verificationCodeService_1 = require("../services/verificationCodeService");
const tokenService_1 = require("../services/tokenService");
const authGuard_1 = require("../middleware/authGuard");
const SYSTEM_ADMIN_PHONE = '15521396332';
const requestCodeSchema = zod_1.z.object({
    phone: zod_1.z
        .string()
        .regex(/^1\d{10}$/u, '手机号格式不正确')
});
const phoneLoginSchema = zod_1.z.object({
    phone: requestCodeSchema.shape.phone,
    code: zod_1.z
        .string()
        .length(6, '验证码为 6 位数字')
});
const refreshSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(10)
});
const wechatLoginSchema = zod_1.z.object({
    code: zod_1.z.string().min(1, '微信临时代码不可为空')
});
exports.authRouter = (0, express_1.Router)();
exports.authRouter.post('/code', async (req, res, next) => {
    try {
        const { phone } = requestCodeSchema.parse(req.body);
        const { code, expiresAt } = await (0, verificationCodeService_1.generateVerificationCode)(phone);
        if (env_1.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.log(`[调试] 向 ${phone} 下发验证码 ${code}（${expiresAt.toISOString()} 过期）`);
        }
        res.json({
            message: '验证码已发送',
            expiresAt
        });
    }
    catch (error) {
        next(error);
    }
});
async function ensureSystemAdmin(userId, phone) {
    if (phone !== SYSTEM_ADMIN_PHONE) {
        return;
    }
    await client_1.pool.query(`
      UPDATE users
      SET role = 'admin'
      WHERE id = $1 AND role <> 'admin'
    `, [userId]);
}
async function fetchUserById(userId) {
    const { rows } = await client_1.pool.query(`
      SELECT id, phone, display_name, role
      FROM users
      WHERE id = $1
    `, [userId]);
    const user = rows[0];
    if (!user) {
        throw new Error('用户不存在');
    }
    return user;
}
exports.authRouter.post('/login/phone', async (req, res, next) => {
    try {
        const { phone, code } = phoneLoginSchema.parse(req.body);
        const isValid = await (0, verificationCodeService_1.verifyCode)(phone, code);
        if (!isValid) {
            return res.status(400).json({ message: '验证码无效或已过期' });
        }
        const displayName = `用户${phone.slice(-4)}`;
        const result = await client_1.pool.query(`
        INSERT INTO users (phone, display_name)
        VALUES ($1, $2)
        ON CONFLICT (phone)
        DO UPDATE SET display_name = COALESCE(users.display_name, EXCLUDED.display_name)
        RETURNING id, phone
      `, [phone, displayName]);
        const baseUser = result.rows[0];
        await ensureSystemAdmin(baseUser.id, baseUser.phone);
        const user = await fetchUserById(baseUser.id);
        const tokens = await (0, tokenService_1.generateTokens)({
            sub: user.id,
            role: user.role
        });
        res.json({
            user,
            ...tokens
        });
    }
    catch (error) {
        next(error);
    }
});
exports.authRouter.post('/login/wechat', async (req, res, next) => {
    try {
        const { code } = wechatLoginSchema.parse(req.body);
        const mockOpenId = `mock_${code}`;
        const result = await client_1.pool.query(`
        INSERT INTO users (wechat_openid, display_name, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (wechat_openid)
        DO UPDATE SET display_name = COALESCE(users.display_name, EXCLUDED.display_name)
        RETURNING id, role
      `, [mockOpenId, `微信用户${mockOpenId.slice(-4)}`, 'organizer']);
        const user = await fetchUserById(result.rows[0].id);
        const tokens = await (0, tokenService_1.generateTokens)({
            sub: user.id,
            role: user.role
        });
        res.json({
            user,
            ...tokens
        });
    }
    catch (error) {
        next(error);
    }
});
exports.authRouter.post('/refresh', async (req, res, next) => {
    try {
        const { refreshToken } = refreshSchema.parse(req.body);
        const tokens = await (0, tokenService_1.rotateRefreshToken)(refreshToken);
        res.json(tokens);
    }
    catch (error) {
        next(error);
    }
});
exports.authRouter.post('/logout', async (req, res, next) => {
    try {
        const { refreshToken } = refreshSchema.parse(req.body);
        await (0, tokenService_1.revokeRefreshToken)(refreshToken);
        res.json({ message: '已退出登录' });
    }
    catch (error) {
        next(error);
    }
});
exports.authRouter.get('/profile', authGuard_1.authGuard, async (req, res, next) => {
    try {
        const result = await client_1.pool.query(`
          SELECT id, phone, wechat_openid, display_name, role, created_at
          FROM users
          WHERE id = $1
        `, [req.user.id]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }
        res.json({ user });
    }
    catch (error) {
        next(error);
    }
});
