"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const app_1 = require("../src/app");
const { mockPoolQuery } = vitest_1.vi.hoisted(() => ({
    mockPoolQuery: vitest_1.vi.fn()
}));
const { mockPoolConnect } = vitest_1.vi.hoisted(() => ({
    mockPoolConnect: vitest_1.vi.fn()
}));
const { mockClientQuery } = vitest_1.vi.hoisted(() => ({
    mockClientQuery: vitest_1.vi.fn()
}));
const { mockClientRelease } = vitest_1.vi.hoisted(() => ({
    mockClientRelease: vitest_1.vi.fn()
}));
vitest_1.vi.mock('../src/database/client', () => ({
    pool: {
        query: mockPoolQuery,
        connect: mockPoolConnect
    }
}));
vitest_1.vi.mock('../src/middleware/authGuard', async () => {
    const actual = await vitest_1.vi.importActual('../src/middleware/authGuard');
    return {
        ...actual,
        authGuard: (req, _res, next) => {
            req.user = { id: 'user-1', role: 'organizer' };
            next();
        }
    };
});
const app = (0, app_1.createApp)();
(0, vitest_1.beforeEach)(() => {
    mockPoolQuery.mockReset();
    mockPoolConnect.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    mockPoolConnect.mockResolvedValue({
        query: mockClientQuery,
        release: mockClientRelease
    });
});
(0, vitest_1.describe)('Competition routes', () => {
    (0, vitest_1.it)('should return event templates', async () => {
        const response = await (0, supertest_1.default)(app).get('/api/competitions/templates/events');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(Array.isArray(response.body.events)).toBe(true);
        (0, vitest_1.expect)(response.body.events.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('should list competitions', async () => {
        mockPoolQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 'comp-1',
                    name: '测试赛事',
                    location: '体育场',
                    start_at: null,
                    end_at: null,
                    signup_start_at: new Date().toISOString(),
                    signup_end_at: new Date().toISOString(),
                    created_by: 'user-1',
                    created_at: new Date().toISOString(),
                    participant_count: 0,
                    team_count: 0
                }
            ]
        });
        const response = await (0, supertest_1.default)(app).get('/api/competitions');
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.competitions).toHaveLength(1);
    });
    (0, vitest_1.it)('should create competition with events and groups', async () => {
        mockClientQuery.mockImplementation(async (sql) => {
            if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
                return { rows: [] };
            }
            if (sql.includes('INSERT INTO competitions')) {
                return { rows: [{ id: 'comp-1' }] };
            }
            return { rows: [] };
        });
        mockPoolQuery.mockImplementation(async (sql) => {
            if (sql.includes('FROM competitions')) {
                return {
                    rows: [
                        {
                            id: 'comp-1',
                            name: '校运会',
                            location: '操场',
                            start_at: null,
                            end_at: null,
                            signup_start_at: new Date().toISOString(),
                            signup_end_at: new Date().toISOString(),
                            config: {},
                            created_by: 'user-1',
                            created_at: new Date().toISOString(),
                            participant_count: 0,
                            team_count: 0
                        }
                    ]
                };
            }
            if (sql.includes('FROM competition_events')) {
                return { rows: [] };
            }
            if (sql.includes('FROM competition_groups')) {
                return { rows: [] };
            }
            if (sql.includes('FROM competition_rules')) {
                return { rows: [] };
            }
            return { rows: [] };
        });
        const response = await (0, supertest_1.default)(app)
            .post('/api/competitions')
            .send({
            name: '校运会',
            signupStartAt: new Date().toISOString(),
            signupEndAt: new Date(Date.now() + 3600 * 1000).toISOString(),
            events: [
                { name: '100m', category: 'track', unitType: 'individual' }
            ],
            groups: [
                { name: '男子组', gender: 'male' }
            ],
            rules: {
                scoring: { top8: [9, 7, 6, 5, 4, 3, 2, 1] }
            }
        });
        (0, vitest_1.expect)(response.status).toBe(201);
        (0, vitest_1.expect)(mockClientQuery).toHaveBeenCalled();
    });
});
