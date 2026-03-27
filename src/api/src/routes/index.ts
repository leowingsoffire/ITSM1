import { Router, Request, Response } from 'express';
import { authRouter } from './auth.routes';
import { incidentRouter } from './incident.routes';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', authRouter);
router.use('/incidents', incidentRouter);

export { router as apiRouter };
