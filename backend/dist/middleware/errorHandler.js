"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
function errorHandler(error, _req, res, _next) {
    if (error instanceof zod_1.ZodError) {
        return res.status(400).json({
            message: '参数校验失败',
            issues: error.issues
        });
    }
    if (error instanceof Error) {
        const statusCode = error.statusCode ??
            error.status ??
            500;
        // eslint-disable-next-line no-console
        console.error('Unhandled error:', error);
        return res.status(statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: '未知错误' });
}
