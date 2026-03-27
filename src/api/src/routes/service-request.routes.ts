import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware';
import { serviceRequestService } from '../services';
import {
  createServiceRequestSchema,
  updateServiceRequestSchema,
  listServiceRequestsQuerySchema,
} from '../types';

const router = Router();

router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listServiceRequestsQuerySchema.parse(req.query);
    const result = await serviceRequestService.listServiceRequests(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sr = await serviceRequestService.getServiceRequestById(req.params.id as string);
    res.json({ data: sr });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createServiceRequestSchema.parse(req.body);
    const sr = await serviceRequestService.createServiceRequest(input, req.user!.userId);
    res.status(201).json({ data: sr });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateServiceRequestSchema.parse(req.body);
    const sr = await serviceRequestService.updateServiceRequest(req.params.id as string, input);
    res.json({ data: sr });
  } catch (err) {
    next(err);
  }
});

export { router as serviceRequestRouter };
