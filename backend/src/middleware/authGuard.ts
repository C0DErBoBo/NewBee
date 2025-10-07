import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export function authGuard(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: '未提供凭证' });
  }

  const [, token] = authHeader.split(' ');
  if (!token) {
    return res.status(401).json({ message: '凭证格式错误' });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as {
      sub: string;
      role: string;
    };
    req.user = {
      id: payload.sub,
      role: payload.role
    };
    next();
  } catch (error) {
    return res.status(401).json({ message: '凭证无效或已过期' });
  }
}
