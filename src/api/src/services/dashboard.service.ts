import { prisma } from '../models';
import { logger } from '../config';

let dashboardCache: { data: unknown; expiry: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function getDashboardStats() {
  if (dashboardCache && Date.now() < dashboardCache.expiry) {
    return dashboardCache.data;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    openIncidents,
    criticalIncidents,
    pendingRequests,
    resolvedToday,
    slaBreaches,
    totalAssets,
    newIncidentsThisWeek,
    byPriority,
    byStatus,
    recentIncidents,
    recentRequests,
    openChanges,
    openProblems,
    knownErrors,
    pendingApprovals,
    recentChanges,
    recentProblems,
  ] = await Promise.all([
    prisma.incident.count({
      where: { status: { in: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] } },
    }),
    prisma.incident.count({
      where: { status: { in: ['NEW', 'IN_PROGRESS'] }, priority: 'CRITICAL' },
    }),
    prisma.serviceRequest.count({
      where: { status: { in: ['SUBMITTED', 'APPROVED', 'IN_PROGRESS'] } },
    }),
    prisma.incident.count({
      where: { resolvedAt: { gte: today } },
    }),
    prisma.incident.count({
      where: { slaBreached: true, status: { in: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] } },
    }),
    prisma.asset.count({ where: { status: 'ACTIVE' } }),
    prisma.incident.count({
      where: { createdAt: { gte: oneWeekAgo } },
    }),
    prisma.incident.groupBy({
      by: ['priority'],
      where: { status: { in: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] } },
      _count: true,
    }),
    prisma.incident.groupBy({
      by: ['status'],
      _count: true,
    }),
    prisma.incident.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, number: true, title: true, status: true, priority: true, createdAt: true,
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.serviceRequest.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, number: true, title: true, status: true, priority: true, createdAt: true,
        requester: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.changeRequest.count({
      where: { status: { in: ['NEW', 'PLANNING', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'IMPLEMENTING'] } },
    }),
    prisma.problem.count({
      where: { status: { in: ['NEW', 'INVESTIGATING', 'ROOT_CAUSE_IDENTIFIED', 'KNOWN_ERROR'] } },
    }),
    prisma.problem.count({
      where: { isKnownError: true, status: { not: 'CLOSED' } },
    }),
    prisma.changeRequest.count({
      where: { status: 'AWAITING_APPROVAL' },
    }),
    prisma.changeRequest.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, number: true, title: true, status: true, type: true, priority: true, createdAt: true,
        requester: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.problem.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, number: true, title: true, status: true, priority: true, isKnownError: true, createdAt: true,
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const priorityMap = Object.fromEntries(byPriority.map(r => [r.priority, r._count]));
  const statusMap = Object.fromEntries(byStatus.map(r => [r.status, r._count]));

  logger.debug('Dashboard stats fetched');

  const result = {
    summary: {
      openIncidents,
      criticalIncidents,
      pendingRequests,
      resolvedToday,
      slaBreaches,
      totalAssets,
      newIncidentsThisWeek,
      openChanges,
      openProblems,
      knownErrors,
      pendingApprovals,
    },
    charts: {
      incidentsByPriority: {
        critical: priorityMap['CRITICAL'] || 0,
        high: priorityMap['HIGH'] || 0,
        medium: priorityMap['MEDIUM'] || 0,
        low: priorityMap['LOW'] || 0,
      },
      incidentsByStatus: {
        new: statusMap['NEW'] || 0,
        inProgress: statusMap['IN_PROGRESS'] || 0,
        onHold: statusMap['ON_HOLD'] || 0,
        resolved: statusMap['RESOLVED'] || 0,
        closed: statusMap['CLOSED'] || 0,
      },
    },
    recentIncidents,
    recentRequests,
    recentChanges,
    recentProblems,
  };

  dashboardCache = { data: result, expiry: Date.now() + CACHE_TTL_MS };
  return result;
}
