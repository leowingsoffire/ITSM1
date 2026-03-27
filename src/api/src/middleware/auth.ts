import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env, logger } from '../config';
import { AppError } from './error-handler';

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Missing or invalid authorization header', 'UNAUTHORIZED');
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    logger.warn('Invalid JWT token presented');
    throw new AppError(401, 'Invalid or expired token', 'TOKEN_INVALID');
  }
}

export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      throw new AppError(403, 'Insufficient permissions', 'FORBIDDEN');
    }
    next();
  };
}
