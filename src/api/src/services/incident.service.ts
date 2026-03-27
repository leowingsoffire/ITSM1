import { Prisma } from '@prisma/client';
import { prisma } from '../models';
import { logger } from '../config';
import { AppError } from '../middleware';
import { CreateIncidentInput, UpdateIncidentInput, ListIncidentsQuery } from '../types';

let incidentCounter = 0;

async function generateIncidentNumber(): Promise<string> {
  const lastIncident = await prisma.incident.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });

  if (lastIncident) {
    const lastNum = parseInt(lastIncident.number.replace('INC', ''), 10);
    incidentCounter = lastNum + 1;
  } else {
    incidentCounter++;
  }

  return `INC${String(incidentCounter).padStart(7, '0')}`;
}

export async function createIncident(input: CreateIncidentInput, createdById: string) {
  const number = await generateIncidentNumber();

  const incident = await prisma.incident.create({
    data: {
      number,
      title: input.title,
      description: input.description,
      priority: input.priority,
      impact: input.impact,
      urgency: input.urgency,
      category: input.category,
      subcategory: input.subcategory,
      assignedToId: input.assignedToId,
      assignedTeamId: input.assignedTeamId,
      relatedAssetId: input.relatedAssetId,
      createdById,
    },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  logger.info({ incidentId: incident.id, number }, 'Incident created');
  return incident;
}

export async function getIncidentById(id: string) {
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedTeam: { select: { id: true, name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      relatedAsset: { select: { id: true, assetTag: true, name: true, type: true } },
      comments: {
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!incident) {
    throw new AppError(404, 'Incident not found', 'NOT_FOUND');
  }

  return incident;
}

export async function listIncidents(query: ListIncidentsQuery) {
  const { page, limit, status, priority, assignedToId, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.IncidentWhereInput = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (assignedToId) where.assignedToId = assignedToId;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { number: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [incidents, total] = await Promise.all([
    prisma.incident.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.incident.count({ where }),
  ]);

  return {
    data: incidents,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function updateIncident(id: string, input: UpdateIncidentInput) {
  const existing = await prisma.incident.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Incident not found', 'NOT_FOUND');
  }

  const updateData: Prisma.IncidentUpdateInput = { ...input };

  if (input.status === 'RESOLVED' && existing.status !== 'RESOLVED') {
    updateData.resolvedAt = new Date();
  }
  if (input.status === 'CLOSED' && existing.status !== 'CLOSED') {
    updateData.closedAt = new Date();
  }

  const incident = await prisma.incident.update({
    where: { id },
    data: updateData,
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  logger.info({ incidentId: id, status: input.status }, 'Incident updated');
  return incident;
}
