import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn()
}));

vi.mock("../src/database/client", () => ({
  pool: {
    query: mockPoolQuery
  }
}));

vi.mock("../src/middleware/authGuard", async () => {
  const actual = await vi.importActual<typeof import("../src/middleware/authGuard")>(
    "../src/middleware/authGuard"
  );
  return {
    ...actual,
    authGuard: (req: any, _res: any, next: () => void) => {
      req.user = { id: "user-1", role: "participant" };
      next();
    }
  };
});

const app = createApp();

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe("Registration routes", () => {
  it("should create registration with new team", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM competitions")) {
        return {
          rows: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              signup_start_at: new Date(Date.now() - 3600_000).toISOString(),
              signup_end_at: new Date(Date.now() + 3600_000).toISOString()
            }
          ]
        };
      }
      if (sql.includes("FROM competition_events")) {
        return { rows: [{ id: "00000000-0000-0000-0000-000000000001" }] };
      }
      if (sql.includes("FROM competition_groups")) {
        return { rows: [{ id: "00000000-0000-0000-0000-000000000002" }] };
      }
      if (sql.includes("INSERT INTO teams")) {
        return { rows: [{ id: "33333333-3333-3333-3333-333333333333" }] };
      }
      if (sql.includes("INSERT INTO competition_registrations")) {
        return {
          rows: [
            {
              id: "22222222-2222-2222-2222-222222222222",
              competition_id: "11111111-1111-1111-1111-111111111111",
              team_id: "33333333-3333-3333-3333-333333333333",
              participant_name: "张三",
              participant_gender: null,
              participant_identity: null,
              contact: "13800138000",
              extra: {},
              attachments: [],
              status: "pending",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ]
        };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .post("/api/registrations")
      .send({
        competitionId: "11111111-1111-1111-1111-111111111111",
        participant: {
          name: "张三",
          contact: "13800138000",
          teamName: "飞人队",
          teamMembers: ["张三"]
        },
        selections: {
          events: [{ eventId: "00000000-0000-0000-0000-000000000001", groupId: "00000000-0000-0000-0000-000000000002" }]
        },
        attachments: [
          { fileName: "proof.pdf", fileUrl: "https://example.com/proof.pdf", size: 1024 }
        ]
      });

    expect(response.status).toBe(201);
    expect(response.body.registration.id).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("should reject invalid event selection", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM competitions")) {
        return {
          rows: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              signup_start_at: new Date(Date.now() - 3600_000).toISOString(),
              signup_end_at: new Date(Date.now() + 3600_000).toISOString()
            }
          ]
        };
      }
      if (sql.includes("FROM competition_events")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .post("/api/registrations")
      .send({
        competitionId: "11111111-1111-1111-1111-111111111111",
        participant: {
          name: "张三"
        },
        selections: {
          events: [{ eventId: "00000000-0000-0000-0000-0000000000FF" }]
        }
      });

    expect(response.status).toBe(400);
  });
});
