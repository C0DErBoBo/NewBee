import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/client';
import { env } from '../config/env';
import {
  generateVerificationCode,
  verifyCode
} from '../services/verificationCodeService';
import {
  generateTokens,
  rotateRefreshToken,
  revokeRefreshToken
} from '../services/tokenService';
import { authGuard, AuthenticatedRequest } from '../middleware/authGuard';

const requestCodeSchema = z.object({
  phone: z
    .string()
    .regex(/^1\d{10}$/u, '手机号格式不正确')
});

const phoneLoginSchema = z.object({
  phone: requestCodeSchema.shape.phone,
  code: z
    .string()
    .length(6, '验证码为 6 位数字')
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10)
});

const wechatLoginSchema = z.object({
  code: z.string().min(1, '微信临时代码不可为空')
});

export const authRouter = Router();

authRouter.post('/code', async (req, res, next) => {
  try {
    const { phone } = requestCodeSchema.parse(req.body);
    const { code, expiresAt } = await generateVerificationCode(phone);

    if (env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[调试] 向 ${phone} 下发验证码 ${code}（${expiresAt.toISOString()} 过期）`);
    }

    res.json({
      message: '验证码已发送',
      expiresAt
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login/phone', async (req, res, next) => {
  try {
    const { phone, code } = phoneLoginSchema.parse(req.body);

    const isValid = await verifyCode(phone, code);
    if (!isValid) {
      return res.status(400).json({ message: '验证码无效或已过期' });
    }

    const displayName = `用户${phone.slice(-4)}`;

    const result = await pool.query(
      `
        INSERT INTO users (phone, display_name)
        VALUES ($1, $2)
        ON CONFLICT (phone)
        DO UPDATE SET display_name = COALESCE(users.display_name, EXCLUDED.display_name)
        RETURNING id, phone, display_name, role
      `,
      [phone, displayName]
    );

    const user = result.rows[0];

    const tokens = await generateTokens({
      sub: user.id,
      role: user.role
    });

    res.json({
      user,
      ...tokens
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login/wechat', async (req, res, next) => {
  try {
    const { code } = wechatLoginSchema.parse(req.body);
    const mockOpenId = `mock_${code}`;

    const result = await pool.query(
      `
        INSERT INTO users (wechat_openid, display_name, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (wechat_openid)
        DO UPDATE SET display_name = COALESCE(users.display_name, EXCLUDED.display_name)
        RETURNING id, phone, display_name, role
      `,
      [mockOpenId, `微信用户${mockOpenId.slice(-4)}`, 'organizer']
    );

    const user = result.rows[0];

    const tokens = await generateTokens({
      sub: user.id,
      role: user.role
    });

    res.json({
      user,
      ...tokens
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const tokens = await rotateRefreshToken(refreshToken);
    res.json(tokens);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    await revokeRefreshToken(refreshToken);
    res.json({ message: '已退出登录' });
  } catch (error) {
    next(error);
  }
});

authRouter.get(
  '/profile',
  authGuard,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await pool.query(
        `
          SELECT id, phone, wechat_openid, display_name, role, created_at
          FROM users
          WHERE id = $1
        `,
        [req.user!.id]
      );
      const user = result.rows[0];
      if (!user) {
        return res.status(404).json({ message: '用户不存在' });
      }
      res.json({ user });
    } catch (error) {
      next(error);
    }
  }
);
