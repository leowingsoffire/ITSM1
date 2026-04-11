import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authRouter } from './auth.routes';
import { incidentRouter } from './incident.routes';
import { dashboardRouter } from './dashboard.routes';
import { serviceRequestRouter } from './service-request.routes';
import { assetRouter } from './asset.routes';
import { knowledgeRouter } from './knowledge.routes';
import { adminRouter } from './admin.routes';
import { changeRouter } from './change.routes';
import { problemRouter } from './problem.routes';
import { notificationRouter } from './notification.routes';

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true });

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', authLimiter, authRouter);
router.use('/dashboard', dashboardRouter);
router.use('/incidents', incidentRouter);
router.use('/service-requests', serviceRequestRouter);
router.use('/assets', assetRouter);
router.use('/knowledge', knowledgeRouter);
router.use('/admin', adminRouter);
router.use('/changes', changeRouter);
router.use('/problems', problemRouter);
router.use('/notifications', notificationRouter);

export { router as apiRouter };
