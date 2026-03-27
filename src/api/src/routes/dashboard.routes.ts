import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware';
import { dashboardService } from '../services';

const router = Router();

router.use(authenticate);

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await dashboardService.getDashboardStats();
    res.json({ data: stats });
  } catch (err) {
    next(err);
  }
});

export { router as dashboardRouter };
