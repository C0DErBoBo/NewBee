import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';

const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('../src/database/client', () => ({
  pool: {
    query: mockPoolQuery,
    connect: mockPoolConnect
  }
}));

vi.mock('../src/middleware/authGuard', async () => {
  const actual = await vi.importActual<typeof import('../src/middleware/authGuard')>(
    '../src/middleware/authGuard'
  );
  return {
    ...actual,
    authGuard: (req: any, _res: any, next: () => void) => {
      req.user = { id: 'user-1', role: 'organizer' };
      next();
    }
  };
});

const app = createApp();

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolConnect.mockReset();
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();

  mockPoolConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockClientRelease
  });
});

describe('Competition routes', () => {
  it('should return event templates', async () => {
    const response = await request(app).get('/api/competitions/templates/events');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.events)).toBe(true);
    expect(response.body.events.length).toBeGreaterThan(0);
  });

  it('should list competitions', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'comp-1',
          name: '测试赛事',
          location: '体育场',
          start_at: null,
          end_at: null,
          created_by: 'user-1',
          created_at: new Date().toISOString()
        }
      ]
    });

    const response = await request(app).get('/api/competitions');
    expect(response.status).toBe(200);
    expect(response.body.competitions).toHaveLength(1);
  });

  it('should create competition with events and groups', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO competitions')) {
        return { rows: [{ id: 'comp-1' }] };
      }
      return { rows: [] };
    });

    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM competitions')) {
        return {
          rows: [
            {
              id: 'comp-1',
              name: '校运会',
              location: '操场',
              start_at: null,
              end_at: null,
              config: {},
              created_by: 'user-1',
              created_at: new Date().toISOString()
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

    const response = await request(app)
      .post('/api/competitions')
      .send({
        name: '校运会',
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

    expect(response.status).toBe(201);
    expect(mockClientQuery).toHaveBeenCalled();
  });
});
