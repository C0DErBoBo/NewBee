import jwt from 'jsonwebtoken';
import { pool } from '../database/client';
import { env } from '../config/env';

interface TokenPayload {
  sub: string;
  role: string;
}

export async function generateTokens(payload: TokenPayload) {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN
  });

  const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN
  });

  const decoded = jwt.verify(
    refreshToken,
    env.JWT_REFRESH_SECRET
  ) as jwt.JwtPayload;

  const expiresAt = new Date(decoded.exp! * 1000);

  await pool.query(
    `
      INSERT INTO refresh_tokens (user_id, token, expires_at)
      VALUES ($1, $2, $3)
    `,
    [payload.sub, refreshToken, expiresAt]
  );

  return {
    accessToken,
    refreshToken
  };
}

export async function rotateRefreshToken(token: string) {
  let payload: TokenPayload & jwt.JwtPayload;
  try {
    payload = jwt.verify(
      token,
      env.JWT_REFRESH_SECRET
    ) as TokenPayload & jwt.JwtPayload;
  } catch (error) {
    throw new Error('刷新令牌无效或已过期');
  }

  const result = await pool.query(
    `
      SELECT id, expires_at
      FROM refresh_tokens
      WHERE token = $1
    `,
    [token]
  );

  const record = result.rows[0];

  if (!record || new Date(record.expires_at).getTime() < Date.now()) {
    throw new Error('刷新令牌不存在或已过期');
  }

  await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [record.id]);

  const { accessToken, refreshToken } = await generateTokens({
    sub: payload.sub,
    role: payload.role
  });

  return {
    accessToken,
    refreshToken
  };
}

export async function revokeRefreshToken(token: string) {
  await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
}
