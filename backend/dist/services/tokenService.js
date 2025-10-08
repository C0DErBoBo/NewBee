"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTokens = generateTokens;
exports.rotateRefreshToken = rotateRefreshToken;
exports.revokeRefreshToken = revokeRefreshToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("../database/client");
const env_1 = require("../config/env");
async function generateTokens(payload) {
    const accessToken = jsonwebtoken_1.default.sign(payload, env_1.env.JWT_SECRET, {
        expiresIn: env_1.env.JWT_EXPIRES_IN
    });
    const refreshToken = jsonwebtoken_1.default.sign(payload, env_1.env.JWT_REFRESH_SECRET, {
        expiresIn: env_1.env.JWT_REFRESH_EXPIRES_IN
    });
    const decoded = jsonwebtoken_1.default.verify(refreshToken, env_1.env.JWT_REFRESH_SECRET);
    const expiresAt = new Date(decoded.exp * 1000);
    await client_1.pool.query(`
      INSERT INTO refresh_tokens (user_id, token, expires_at)
      VALUES ($1, $2, $3)
    `, [payload.sub, refreshToken, expiresAt]);
    return {
        accessToken,
        refreshToken
    };
}
async function rotateRefreshToken(token) {
    let payload;
    try {
        payload = jsonwebtoken_1.default.verify(token, env_1.env.JWT_REFRESH_SECRET);
    }
    catch (error) {
        throw new Error('刷新令牌无效或已过期');
    }
    const result = await client_1.pool.query(`
      SELECT id, expires_at
      FROM refresh_tokens
      WHERE token = $1
    `, [token]);
    const record = result.rows[0];
    if (!record || new Date(record.expires_at).getTime() < Date.now()) {
        throw new Error('刷新令牌不存在或已过期');
    }
    await client_1.pool.query('DELETE FROM refresh_tokens WHERE id = $1', [record.id]);
    const { accessToken, refreshToken } = await generateTokens({
        sub: payload.sub,
        role: payload.role
    });
    return {
        accessToken,
        refreshToken
    };
}
async function revokeRefreshToken(token) {
    await client_1.pool.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
}
