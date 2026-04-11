import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware';
import { problemService } from '../services';
import { createProblemSchema, updateProblemSchema, listProblemsQuerySchema } from '../types';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listProblemsQuerySchema.parse(req.query);
    const result = await problemService.listProblems(query);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const problem = await problemService.getProblemById(req.params.id as string);
    res.json({ data: problem });
  } catch (err) { next(err); }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createProblemSchema.parse(req.body);
    const problem = await problemService.createProblem(input, req.user!.userId);
    res.status(201).json({ data: problem });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateProblemSchema.parse(req.body);
    const problem = await problemService.updateProblem(req.params.id as string, input);
    res.json({ data: problem });
  } catch (err) { next(err); }
});

// Link/unlink incidents
const linkSchema = z.object({ incidentId: z.string().uuid() });

router.post('/:id/link-incident', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { incidentId } = linkSchema.parse(req.body);
    await problemService.linkIncidentToProblem(req.params.id as string, incidentId);
    res.json({ data: { message: 'Incident linked to problem' } });
  } catch (err) { next(err); }
});

router.post('/:id/unlink-incident', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { incidentId } = linkSchema.parse(req.body);
    await problemService.unlinkIncidentFromProblem(incidentId);
    res.json({ data: { message: 'Incident unlinked from problem' } });
  } catch (err) { next(err); }
});

export { router as problemRouter };
