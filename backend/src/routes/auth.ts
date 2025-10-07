import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../database/client';
import { env } from '../config/env';

const loginSchema = z.object({
  phone: z.string().min(4),
  password: z.string().min(6)
});

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const { phone, password } = loginSchema.parse(req.body);
    const result = await pool.query(
      'SELECT id, password_hash, role FROM users WHERE phone = $1 LIMIT 1',
      [phone]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: '账号或密码错误' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: '账号或密码错误' });
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user.id,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});
