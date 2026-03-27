import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware';
import { incidentService } from '../services';
import {
  createIncidentSchema,
  updateIncidentSchema,
  listIncidentsQuerySchema,
} from '../types';

const router = Router();

router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listIncidentsQuerySchema.parse(req.query);
    const result = await incidentService.listIncidents(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const incident = await incidentService.getIncidentById(req.params.id);
    res.json({ data: incident });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createIncidentSchema.parse(req.body);
    const incident = await incidentService.createIncident(input, req.user!.userId);
    res.status(201).json({ data: incident });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateIncidentSchema.parse(req.body);
    const incident = await incidentService.updateIncident(req.params.id, input);
    res.json({ data: incident });
  } catch (err) {
    next(err);
  }
});

export { router as incidentRouter };
