"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const vitest_1 = require("vitest");
const app_1 = require("../src/app");
const { mockGenerateVerificationCode } = vitest_1.vi.hoisted(() => ({
    mockGenerateVerificationCode: vitest_1.vi.fn()
}));
const { mockVerifyCode } = vitest_1.vi.hoisted(() => ({
    mockVerifyCode: vitest_1.vi.fn()
}));
const { mockGenerateTokens } = vitest_1.vi.hoisted(() => ({
    mockGenerateTokens: vitest_1.vi.fn()
}));
const { mockRotateRefreshToken } = vitest_1.vi.hoisted(() => ({
    mockRotateRefreshToken: vitest_1.vi.fn()
}));
const { mockRevokeRefreshToken } = vitest_1.vi.hoisted(() => ({
    mockRevokeRefreshToken: vitest_1.vi.fn()
}));
const { mockPoolQuery } = vitest_1.vi.hoisted(() => ({
    mockPoolQuery: vitest_1.vi.fn()
}));
vitest_1.vi.mock('../src/services/verificationCodeService', () => ({
    generateVerificationCode: mockGenerateVerificationCode,
    verifyCode: mockVerifyCode
}));
vitest_1.vi.mock('../src/services/tokenService', () => ({
    generateTokens: mockGenerateTokens,
    rotateRefreshToken: mockRotateRefreshToken,
    revokeRefreshToken: mockRevokeRefreshToken
}));
vitest_1.vi.mock('../src/database/client', () => ({
    pool: {
        query: mockPoolQuery
    }
}));
const app = (0, app_1.createApp)();
(0, vitest_1.beforeEach)(() => {
    mockGenerateVerificationCode.mockReset();
    mockVerifyCode.mockReset();
    mockGenerateTokens.mockReset();
    mockRotateRefreshToken.mockReset();
    mockRevokeRefreshToken.mockReset();
    mockPoolQuery.mockReset();
});
(0, vitest_1.describe)('Auth routes', () => {
    (0, vitest_1.it)('should reject invalid phone number when requesting code', async () => {
        const response = await (0, supertest_1.default)(app)
            .post('/api/auth/code')
            .send({ phone: '123456' });
        (0, vitest_1.expect)(response.status).toBe(400);
    });
    (0, vitest_1.it)('should send verification code for valid phone', async () => {
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        mockGenerateVerificationCode.mockResolvedValueOnce({
            code: '123456',
            expiresAt
        });
        const response = await (0, supertest_1.default)(app)
            .post('/api/auth/code')
            .send({ phone: '13800000000' });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(mockGenerateVerificationCode).toHaveBeenCalledWith('13800000000');
    });
    (0, vitest_1.it)('should login with phone code', async () => {
        mockVerifyCode.mockResolvedValueOnce(true);
        mockPoolQuery
            .mockResolvedValueOnce({
            rows: [
                {
                    id: 'user-1',
                    phone: '13800000000'
                }
            ]
        })
            .mockResolvedValueOnce({
            rows: [
                {
                    id: 'user-1',
                    phone: '13800000000',
                    display_name: '用户0000',
                    role: 'organizer'
                }
            ]
        });
        mockGenerateTokens.mockResolvedValueOnce({
            accessToken: 'access-token',
            refreshToken: 'refresh-token'
        });
        const response = await (0, supertest_1.default)(app)
            .post('/api/auth/login/phone')
            .send({ phone: '13800000000', code: '123456' });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.user.phone).toBe('13800000000');
        (0, vitest_1.expect)(response.body.accessToken).toBe('access-token');
        (0, vitest_1.expect)(mockVerifyCode).toHaveBeenCalledWith('13800000000', '123456');
    });
    (0, vitest_1.it)('should refresh access token with valid refresh token', async () => {
        mockRotateRefreshToken.mockResolvedValueOnce({
            accessToken: 'new-access',
            refreshToken: 'new-refresh'
        });
        const response = await (0, supertest_1.default)(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: 'old-refresh' });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(mockRotateRefreshToken).toHaveBeenCalledWith('old-refresh');
        (0, vitest_1.expect)(response.body.accessToken).toBe('new-access');
    });
    (0, vitest_1.it)('should return user profile when authorization header is valid', async () => {
        const token = jsonwebtoken_1.default.sign({ sub: 'user-1', role: 'organizer' }, process.env.JWT_SECRET ?? 'dev-secret-key-change-me');
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
        const response = await (0, supertest_1.default)(app)
            .get('/api/auth/profile')
            .set('Authorization', `Bearer ${token}`);
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.user.id).toBe('user-1');
    });
});
