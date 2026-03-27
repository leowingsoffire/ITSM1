import { prisma } from '../models';
import { logger } from '../config';

export async function getDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    openIncidents,
    criticalIncidents,
    pendingRequests,
    resolvedToday,
    slaBreaches,
    totalAssets,
    newIncidentsThisWeek,
    incidentsByPriority,
    incidentsByStatus,
    recentIncidents,
    recentRequests,
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
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    Promise.all([
      prisma.incident.count({ where: { priority: 'CRITICAL', status: { in: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] } } }),
      prisma.incident.count({ where: { priority: 'HIGH', status: { in: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] } } }),
      prisma.incident.count({ where: { priority: 'MEDIUM', status: { in: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] } } }),
      prisma.incident.count({ where: { priority: 'LOW', status: { in: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] } } }),
    ]),
    Promise.all([
      prisma.incident.count({ where: { status: 'NEW' } }),
      prisma.incident.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.incident.count({ where: { status: 'ON_HOLD' } }),
      prisma.incident.count({ where: { status: 'RESOLVED' } }),
      prisma.incident.count({ where: { status: 'CLOSED' } }),
    ]),
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
  ]);

  logger.debug('Dashboard stats fetched');

  return {
    summary: {
      openIncidents,
      criticalIncidents,
      pendingRequests,
      resolvedToday,
      slaBreaches,
      totalAssets,
      newIncidentsThisWeek,
    },
    charts: {
      incidentsByPriority: {
        critical: incidentsByPriority[0],
        high: incidentsByPriority[1],
        medium: incidentsByPriority[2],
        low: incidentsByPriority[3],
      },
      incidentsByStatus: {
        new: incidentsByStatus[0],
        inProgress: incidentsByStatus[1],
        onHold: incidentsByStatus[2],
        resolved: incidentsByStatus[3],
        closed: incidentsByStatus[4],
      },
    },
    recentIncidents,
    recentRequests,
  };
}
