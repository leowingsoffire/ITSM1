import { Prisma } from '@prisma/client';
import { prisma } from '../models';
import { logger } from '../config';
import { AppError } from '../middleware';
import { CreateProblemInput, UpdateProblemInput, ListProblemsQuery } from '../types';

let problemCounter = 0;

async function generateProblemNumber(): Promise<string> {
  const last = await prisma.problem.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  if (last) {
    problemCounter = parseInt(last.number.replace('PRB', ''), 10) + 1;
  } else {
    problemCounter++;
  }
  return `PRB${String(problemCounter).padStart(7, '0')}`;
}

const includeFields = {
  assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
  assignedTeam: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
};

export async function createProblem(input: CreateProblemInput, createdById: string) {
  const number = await generateProblemNumber();

  const problem = await prisma.problem.create({
    data: {
      number,
      title: input.title,
      description: input.description,
      priority: input.priority,
      impact: input.impact,
      category: input.category,
      assignedToId: input.assignedToId,
      assignedTeamId: input.assignedTeamId,
      createdById,
    },
    include: includeFields,
  });

  logger.info({ problemId: problem.id, number }, 'Problem created');
  return problem;
}

export async function getProblemById(id: string) {
  const problem = await prisma.problem.findUnique({
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
  if (!problem) throw new AppError(404, 'Problem not found', 'NOT_FOUND');
  return problem;
}

export async function listProblems(query: ListProblemsQuery) {
  const { page, limit, status, priority, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.ProblemWhereInput = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { number: { contains: search } },
    ];
  }

  const [problems, total] = await Promise.all([
    prisma.problem.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { incidents: true } },
      },
    }),
    prisma.problem.count({ where }),
  ]);

  return {
    data: problems,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateProblem(id: string, input: UpdateProblemInput) {
  const problem = await prisma.$transaction(async (tx) => {
    const existing = await tx.problem.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Problem not found', 'NOT_FOUND');

    const updateData: Prisma.ProblemUpdateInput = { ...input };

    if (input.status === 'KNOWN_ERROR' && !existing.isKnownError) {
      updateData.isKnownError = true;
    }
    if (input.status === 'RESOLVED' && existing.status !== 'RESOLVED') {
      updateData.resolvedAt = new Date();
    }
    if (input.status === 'CLOSED' && existing.status !== 'CLOSED') {
      updateData.closedAt = new Date();
    }

    return tx.problem.update({
      where: { id },
      data: updateData,
      include: includeFields,
    });
  });

  logger.info({ problemId: id, status: input.status }, 'Problem updated');
  return problem;
}

export async function linkIncidentToProblem(problemId: string, incidentId: string) {
  await prisma.incident.update({
    where: { id: incidentId },
    data: { problemId },
  });
  logger.info({ problemId, incidentId }, 'Incident linked to problem');
}

export async function unlinkIncidentFromProblem(incidentId: string) {
  await prisma.incident.update({
    where: { id: incidentId },
    data: { problemId: null },
  });
}
