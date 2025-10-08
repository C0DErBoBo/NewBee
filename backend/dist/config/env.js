"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    PORT: zod_1.z.string().transform(Number).default('4000'),
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: zod_1.z
        .string()
        .url()
        .default('postgres://postgres:postgres@127.0.0.1:5432/competition_system'),
    JWT_SECRET: zod_1.z
        .string()
        .min(16)
        .default('dev-secret-key-change-me'),
    JWT_EXPIRES_IN: zod_1.z.string().default('1h'),
    JWT_REFRESH_SECRET: zod_1.z
        .string()
        .min(16)
        .default('dev-refresh-secret-change-me'),
    JWT_REFRESH_EXPIRES_IN: zod_1.z.string().default('7d')
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('环境变量校验失败', parsed.error.flatten().fieldErrors);
    throw new Error('环境变量不合法，无法启动服务');
}
exports.env = parsed.data;
