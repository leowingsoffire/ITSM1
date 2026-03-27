import { Prisma } from '@prisma/client';
import { prisma } from '../models';
import { logger } from '../config';
import { AppError } from '../middleware';
import { UpdateUserInput, ListUsersQuery, CreateTeamInput, UpdateTeamInput, CreateCommentInput } from '../types';

// ─── Users ───────────────────────────────────────────────────

export async function listUsers(query: ListUsersQuery) {
  const { page, limit, role, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.UserWhereInput = {};
  if (role) where.role = role;
  if (search) {
    where.OR = [
      { email: { contains: search } },
      { firstName: { contains: search } },
      { lastName: { contains: search } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, createdAt: true,
        team: { select: { id: true, name: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data: users,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      role: true, isActive: true, createdAt: true, updatedAt: true,
      team: { select: { id: true, name: true } },
      _count: {
        select: {
          assignedIncidents: true,
          createdIncidents: true,
          serviceRequests: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError(404, 'User not found', 'NOT_FOUND');
  }

  return user;
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'User not found', 'NOT_FOUND');
  }

  const user = await prisma.user.update({
    where: { id },
    data: input,
    select: {
      id: true, email: true, firstName: true, lastName: true,
      role: true, isActive: true, createdAt: true,
      team: { select: { id: true, name: true } },
    },
  });

  logger.info({ userId: id, role: input.role }, 'User updated');
  return user;
}

// ─── Teams ───────────────────────────────────────────────────

export async function listTeams() {
  return prisma.team.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { members: true, incidents: true } },
    },
  });
}

export async function createTeam(input: CreateTeamInput) {
  const team = await prisma.team.create({ data: input });
  logger.info({ teamId: team.id }, 'Team created');
  return team;
}

export async function updateTeam(id: string, input: UpdateTeamInput) {
  const existing = await prisma.team.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Team not found', 'NOT_FOUND');
  }

  const team = await prisma.team.update({ where: { id }, data: input });
  logger.info({ teamId: id }, 'Team updated');
  return team;
}

export async function getTeamById(id: string) {
  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      members: {
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      },
      _count: { select: { members: true, incidents: true } },
    },
  });

  if (!team) {
    throw new AppError(404, 'Team not found', 'NOT_FOUND');
  }

  return team;
}

// ─── Comments ────────────────────────────────────────────────

export async function listComments(incidentId?: string, serviceRequestId?: string) {
  const where: Prisma.CommentWhereInput = {};
  if (incidentId) where.incidentId = incidentId;
  if (serviceRequestId) where.serviceRequestId = serviceRequestId;

  return prisma.comment.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export async function createComment(input: CreateCommentInput, authorId: string) {
  if (!input.incidentId && !input.serviceRequestId) {
    throw new AppError(400, 'Must specify incidentId or serviceRequestId', 'VALIDATION_ERROR');
  }

  const comment = await prisma.comment.create({
    data: {
      content: input.content,
      isPublic: input.isPublic,
      authorId,
      incidentId: input.incidentId,
      serviceRequestId: input.serviceRequestId,
    },
    include: {
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  logger.info({ commentId: comment.id }, 'Comment created');
  return comment;
}
