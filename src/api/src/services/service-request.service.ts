import { Prisma } from '@prisma/client';
import { prisma } from '../models';
import { logger } from '../config';
import { AppError } from '../middleware';
import { CreateServiceRequestInput, UpdateServiceRequestInput, ListServiceRequestsQuery } from '../types';

let srCounter = 0;

async function generateSRNumber(): Promise<string> {
  const last = await prisma.serviceRequest.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });

  if (last) {
    const lastNum = parseInt(last.number.replace('SR', ''), 10);
    srCounter = lastNum + 1;
  } else {
    srCounter++;
  }

  return `SR${String(srCounter).padStart(7, '0')}`;
}

export async function createServiceRequest(input: CreateServiceRequestInput, requesterId: string) {
  const number = await generateSRNumber();

  const sr = await prisma.serviceRequest.create({
    data: {
      number,
      title: input.title,
      description: input.description,
      priority: input.priority,
      category: input.category,
      requesterId,
    },
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  logger.info({ srId: sr.id, number }, 'Service request created');
  return sr;
}

export async function getServiceRequestById(id: string) {
  const sr = await prisma.serviceRequest.findUnique({
    where: { id },
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, email: true } },
      comments: {
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!sr) {
    throw new AppError(404, 'Service request not found', 'NOT_FOUND');
  }

  return sr;
}

export async function listServiceRequests(query: ListServiceRequestsQuery) {
  const { page, limit, status, priority, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.ServiceRequestWhereInput = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { number: { contains: search } },
    ];
  }

  const [requests, total] = await Promise.all([
    prisma.serviceRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.serviceRequest.count({ where }),
  ]);

  return {
    data: requests,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateServiceRequest(id: string, input: UpdateServiceRequestInput) {
  const sr = await prisma.$transaction(async (tx) => {
    const existing = await tx.serviceRequest.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'Service request not found', 'NOT_FOUND');
    }

    const updateData: Prisma.ServiceRequestUpdateInput = { ...input };
    if (input.status === 'FULFILLED' && existing.status !== 'FULFILLED') {
      updateData.fulfilledAt = new Date();
    }

    return tx.serviceRequest.update({
      where: { id },
      data: updateData,
      include: {
        requester: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  });

  logger.info({ srId: id, status: input.status }, 'Service request updated');
  return sr;
}
