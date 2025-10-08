"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authGuard = authGuard;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
function authGuard(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: '未提供凭证' });
    }
    const [, token] = authHeader.split(' ');
    if (!token) {
        return res.status(401).json({ message: '凭证格式错误' });
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET);
        req.user = {
            id: payload.sub,
            role: payload.role
        };
        next();
    }
    catch (error) {
        return res.status(401).json({ message: '凭证无效或已过期' });
    }
}
