import { Prisma } from '@prisma/client';
import { prisma } from '../models';
import { logger } from '../config';
import { AppError } from '../middleware';
import { CreateChangeInput, UpdateChangeInput, ListChangesQuery } from '../types';

let changeCounter = 0;

async function generateChangeNumber(): Promise<string> {
  const last = await prisma.changeRequest.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  if (last) {
    changeCounter = parseInt(last.number.replace('CHG', ''), 10) + 1;
  } else {
    changeCounter++;
  }
  return `CHG${String(changeCounter).padStart(7, '0')}`;
}

const includeFields = {
  requester: { select: { id: true, firstName: true, lastName: true, email: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
  assignedTeam: { select: { id: true, name: true } },
  approvals: {
    include: { approver: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
};

export async function createChange(input: CreateChangeInput, requesterId: string) {
  const number = await generateChangeNumber();

  const change = await prisma.changeRequest.create({
    data: {
      number,
      title: input.title,
      description: input.description,
      type: input.type,
      priority: input.priority,
      risk: input.risk,
      impact: input.impact,
      category: input.category,
      reason: input.reason,
      implementationPlan: input.implementationPlan,
      backoutPlan: input.backoutPlan,
      testPlan: input.testPlan,
      scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : undefined,
      scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : undefined,
      assignedToId: input.assignedToId,
      assignedTeamId: input.assignedTeamId,
      requesterId,
    },
    include: includeFields,
  });

  logger.info({ changeId: change.id, number }, 'Change request created');
  return change;
}

export async function getChangeById(id: string) {
  const change = await prisma.changeRequest.findUnique({
    where: { id },
    include: {
      ...includeFields,
      comments: {
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      },
      incidents: {
        select: { id: true, number: true, title: true, status: true, priority: true },
      },
    },
  });
  if (!change) throw new AppError(404, 'Change request not found', 'NOT_FOUND');
  return change;
}

export async function listChanges(query: ListChangesQuery) {
  const { page, limit, status, type, priority, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.ChangeRequestWhereInput = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (priority) where.priority = priority;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { number: { contains: search } },
    ];
  }

  const [changes, total] = await Promise.all([
    prisma.changeRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { approvals: true } },
      },
    }),
    prisma.changeRequest.count({ where }),
  ]);

  return {
    data: changes,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateChange(id: string, input: UpdateChangeInput) {
  const change = await prisma.$transaction(async (tx) => {
    const existing = await tx.changeRequest.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Change request not found', 'NOT_FOUND');

    const updateData: Prisma.ChangeRequestUpdateInput = {};
    const fields = [
      'title', 'description', 'type', 'priority', 'risk', 'impact',
      'category', 'reason', 'implementationPlan', 'backoutPlan', 'testPlan',
      'status', 'assignedToId', 'assignedTeamId',
    ] as const;

    for (const f of fields) {
      if ((input as Record<string, unknown>)[f] !== undefined) {
        (updateData as Record<string, unknown>)[f] = (input as Record<string, unknown>)[f];
      }
    }

    if (input.scheduledStart) updateData.scheduledStart = new Date(input.scheduledStart);
    if (input.scheduledEnd) updateData.scheduledEnd = new Date(input.scheduledEnd);
    if (input.actualStart) updateData.actualStart = new Date(input.actualStart);
    if (input.actualEnd) updateData.actualEnd = new Date(input.actualEnd);

    if (input.status === 'COMPLETED' || input.status === 'FAILED' || input.status === 'CANCELLED') {
      updateData.closedAt = new Date();
    }

    return tx.changeRequest.update({
      where: { id },
      data: updateData,
      include: includeFields,
    });
  });

  logger.info({ changeId: id, status: input.status }, 'Change request updated');
  return change;
}

export async function submitApproval(changeId: string, approverId: string, status: 'APPROVED' | 'REJECTED', comments?: string) {
  const change = await prisma.changeRequest.findUnique({ where: { id: changeId } });
  if (!change) throw new AppError(404, 'Change request not found', 'NOT_FOUND');

  const approval = await prisma.approval.create({
    data: {
      changeRequestId: changeId,
      approverId,
      status,
      comments,
      decidedAt: new Date(),
    },
    include: { approver: { select: { id: true, firstName: true, lastName: true } } },
  });

  // Auto-update change status based on approval
  if (status === 'APPROVED') {
    await prisma.changeRequest.update({
      where: { id: changeId },
      data: { status: 'APPROVED' },
    });
  } else if (status === 'REJECTED') {
    await prisma.changeRequest.update({
      where: { id: changeId },
      data: { status: 'CANCELLED' },
    });
  }

  logger.info({ changeId, approverId, status }, 'Change approval submitted');
  return approval;
}
