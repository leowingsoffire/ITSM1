import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services';
import { registerSchema, loginSchema } from '../types';

const router = Router();

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = registerSchema.parse(req.body);
    const user = await authService.register(input);
    res.status(201).json({ data: user });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

export { router as authRouter };
