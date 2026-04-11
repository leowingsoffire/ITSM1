import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware';
import { notificationService } from '../services';

const router = Router();
router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const notifications = await notificationService.getNotifications(req.user!.userId, unreadOnly);
    const unreadCount = await notificationService.getUnreadCount(req.user!.userId);
    res.json({ data: notifications, unreadCount });
  } catch (err) { next(err); }
});

router.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await notificationService.markAsRead(req.params.id as string, req.user!.userId);
    res.json({ data: { message: 'Marked as read' } });
  } catch (err) { next(err); }
});

router.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await notificationService.markAllAsRead(req.user!.userId);
    res.json({ data: { message: 'All notifications marked as read' } });
  } catch (err) { next(err); }
});

export { router as notificationRouter };
