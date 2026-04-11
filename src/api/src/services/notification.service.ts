import { prisma } from '../models';
import { logger } from '../config';

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  link?: string
) {
  const notification = await prisma.notification.create({
    data: { userId, type, title, message, link },
  });
  logger.debug({ userId, type, title }, 'Notification created');
  return notification;
}

export async function getNotifications(userId: string, unreadOnly = false) {
  const where: { userId: string; isRead?: boolean } = { userId };
  if (unreadOnly) where.isRead = false;

  return prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function getUnreadCount(userId: string) {
  return prisma.notification.count({
    where: { userId, isRead: false },
  });
}

export async function markAsRead(id: string, userId: string) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}
