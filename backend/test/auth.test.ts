import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';

const mockGenerateVerificationCode = vi.fn();
const mockVerifyCode = vi.fn();
const mockGenerateTokens = vi.fn();
const mockRotateRefreshToken = vi.fn();
const mockRevokeRefreshToken = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock('../src/services/verificationCodeService', () => ({
  generateVerificationCode: mockGenerateVerificationCode,
  verifyCode: mockVerifyCode
}));

vi.mock('../src/services/tokenService', () => ({
  generateTokens: mockGenerateTokens,
  rotateRefreshToken: mockRotateRefreshToken,
  revokeRefreshToken: mockRevokeRefreshToken
}));

vi.mock('../src/database/client', () => ({
  pool: {
    query: mockPoolQuery
  }
}));

const app = createApp();

beforeEach(() => {
  mockGenerateVerificationCode.mockReset();
  mockVerifyCode.mockReset();
  mockGenerateTokens.mockReset();
  mockRotateRefreshToken.mockReset();
  mockRevokeRefreshToken.mockReset();
  mockPoolQuery.mockReset();
});

describe('Auth routes', () => {
  it('should reject invalid phone number when requesting code', async () => {
    const response = await request(app)
      .post('/api/auth/code')
      .send({ phone: '123456' });
    expect(response.status).toBe(400);
  });

  it('should send verification code for valid phone', async () => {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    mockGenerateVerificationCode.mockResolvedValueOnce({
      code: '123456',
      expiresAt
    });

    const response = await request(app)
      .post('/api/auth/code')
      .send({ phone: '13800000000' });

    expect(response.status).toBe(200);
    expect(mockGenerateVerificationCode).toHaveBeenCalledWith('13800000000');
  });

  it('should login with phone code', async () => {
    mockVerifyCode.mockResolvedValueOnce(true);
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO users')) {
        return {
          rows: [
            {
              id: 'user-1',
              phone: '13800000000',
              display_name: '用户0000',
              role: 'organizer'
            }
          ]
        };
      }
      return { rows: [] };
    });
    mockGenerateTokens.mockResolvedValueOnce({
      accessToken: 'access-token',
      refreshToken: 'refresh-token'
    });

    const response = await request(app)
      .post('/api/auth/login/phone')
      .send({ phone: '13800000000', code: '123456' });

    expect(response.status).toBe(200);
    expect(response.body.user.phone).toBe('13800000000');
    expect(response.body.accessToken).toBe('access-token');
    expect(mockVerifyCode).toHaveBeenCalledWith('13800000000', '123456');
  });

  it('should refresh access token with valid refresh token', async () => {
    mockRotateRefreshToken.mockResolvedValueOnce({
      accessToken: 'new-access',
      refreshToken: 'new-refresh'
    });

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'old-refresh' });

    expect(response.status).toBe(200);
    expect(mockRotateRefreshToken).toHaveBeenCalledWith('old-refresh');
    expect(response.body.accessToken).toBe('new-access');
  });

  it('should return user profile when authorization header is valid', async () => {
    const token = jwt.sign(
      { sub: 'user-1', role: 'organizer' },
      process.env.JWT_SECRET ?? 'dev-secret-key-change-me'
    );

    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          phone: '13800000000',
          wechat_openid: null,
          display_name: '用户0000',
          role: 'organizer',
          created_at: new Date().toISOString()
        }
      ]
    });

    const response = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe('user-1');
  });
});
