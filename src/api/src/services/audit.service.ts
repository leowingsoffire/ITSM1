import { prisma } from '../models';
import { logger } from '../config';

export async function logAction(
  userId: string,
  entity: string,
  entityId: string,
  action: string,
  changes?: Array<{ field: string; oldValue?: string; newValue?: string }>
) {
  const entries = changes && changes.length > 0
    ? changes.map(c => ({
        userId,
        entity,
        entityId,
        action,
        field: c.field,
        oldValue: c.oldValue ?? null,
        newValue: c.newValue ?? null,
      }))
    : [{ userId, entity, entityId, action, field: null, oldValue: null, newValue: null }];

  await prisma.auditLog.createMany({ data: entries });
  logger.debug({ entity, entityId, action, userId }, 'Audit log entry created');
}

export async function getAuditLogs(entity: string, entityId: string) {
  return prisma.auditLog.findMany({
    where: { entity, entityId },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function getRecentAuditLogs(limit = 50) {
  return prisma.auditLog.findMany({
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
