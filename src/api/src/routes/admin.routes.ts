import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware';
import { adminService } from '../services';
import {
  updateUserSchema, listUsersQuerySchema,
  createTeamSchema, updateTeamSchema, createCommentSchema,
} from '../types';

const router = Router();

router.use(authenticate);

// ─── Users ───────────────────────────────────────────────────

router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listUsersQuerySchema.parse(req.query);
    const result = await adminService.listUsers(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await adminService.getUserById(req.params.id as string);
    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', authorize('ADMIN', 'MANAGER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateUserSchema.parse(req.body);
    const user = await adminService.updateUser(req.params.id as string, input);
    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

// ─── Teams ───────────────────────────────────────────────────

router.get('/teams', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const teams = await adminService.listTeams();
    res.json({ data: teams });
  } catch (err) {
    next(err);
  }
});

router.post('/teams', authorize('ADMIN', 'MANAGER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createTeamSchema.parse(req.body);
    const team = await adminService.createTeam(input);
    res.status(201).json({ data: team });
  } catch (err) {
    next(err);
  }
});

router.get('/teams/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const team = await adminService.getTeamById(req.params.id as string);
    res.json({ data: team });
  } catch (err) {
    next(err);
  }
});

router.patch('/teams/:id', authorize('ADMIN', 'MANAGER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateTeamSchema.parse(req.body);
    const team = await adminService.updateTeam(req.params.id as string, input);
    res.json({ data: team });
  } catch (err) {
    next(err);
  }
});

// ─── Comments ────────────────────────────────────────────────

router.get('/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { incidentId, serviceRequestId } = req.query;
    const comments = await adminService.listComments(
      incidentId as string | undefined,
      serviceRequestId as string | undefined,
    );
    res.json({ data: comments });
  } catch (err) {
    next(err);
  }
});

router.post('/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createCommentSchema.parse(req.body);
    const comment = await adminService.createComment(input, req.user!.userId);
    res.status(201).json({ data: comment });
  } catch (err) {
    next(err);
  }
});

export { router as adminRouter };
