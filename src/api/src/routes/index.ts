import { Router, Request, Response } from 'express';
import { authRouter } from './auth.routes';
import { incidentRouter } from './incident.routes';
import { dashboardRouter } from './dashboard.routes';
import { serviceRequestRouter } from './service-request.routes';
import { assetRouter } from './asset.routes';
import { knowledgeRouter } from './knowledge.routes';
import { adminRouter } from './admin.routes';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', authRouter);
router.use('/dashboard', dashboardRouter);
router.use('/incidents', incidentRouter);
router.use('/service-requests', serviceRequestRouter);
router.use('/assets', assetRouter);
router.use('/knowledge', knowledgeRouter);
router.use('/admin', adminRouter);

export { router as apiRouter };
