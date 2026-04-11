import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware';
import { changeService } from '../services';
import { createChangeSchema, updateChangeSchema, listChangesQuerySchema } from '../types';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listChangesQuerySchema.parse(req.query);
    const result = await changeService.listChanges(query);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const change = await changeService.getChangeById(req.params.id as string);
    res.json({ data: change });
  } catch (err) { next(err); }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createChangeSchema.parse(req.body);
    const change = await changeService.createChange(input, req.user!.userId);
    res.status(201).json({ data: change });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateChangeSchema.parse(req.body);
    const change = await changeService.updateChange(req.params.id as string, input);
    res.json({ data: change });
  } catch (err) { next(err); }
});

// Approval endpoints
const approvalSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  comments: z.string().max(2000).optional(),
});

router.post('/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = approvalSchema.parse(req.body);
    const approval = await changeService.submitApproval(
      req.params.id as string,
      req.user!.userId,
      input.status,
      input.comments
    );
    res.status(201).json({ data: approval });
  } catch (err) { next(err); }
});

export { router as changeRouter };
