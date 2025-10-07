import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      message: '参数校验失败',
      issues: error.issues
    });
  }

  if (error instanceof Error) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', error);
    return res.status(500).json({ message: error.message });
  }

  return res.status(500).json({ message: '未知错误' });
}
