import { Prisma } from '@prisma/client';
import { prisma } from '../models';
import { logger } from '../config';
import { AppError } from '../middleware';
import { CreateAssetInput, UpdateAssetInput, ListAssetsQuery } from '../types';

let assetCounter = 0;

async function generateAssetTag(): Promise<string> {
  const last = await prisma.asset.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { assetTag: true },
  });

  if (last) {
    const lastNum = parseInt(last.assetTag.replace('AST', ''), 10);
    assetCounter = lastNum + 1;
  } else {
    assetCounter++;
  }

  return `AST${String(assetCounter).padStart(7, '0')}`;
}

export async function createAsset(input: CreateAssetInput) {
  const assetTag = await generateAssetTag();

  const asset = await prisma.asset.create({
    data: {
      assetTag,
      name: input.name,
      type: input.type,
      manufacturer: input.manufacturer,
      model: input.model,
      serialNumber: input.serialNumber,
      location: input.location,
      purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : undefined,
      warrantyEnd: input.warrantyEnd ? new Date(input.warrantyEnd) : undefined,
    },
  });

  logger.info({ assetId: asset.id, assetTag }, 'Asset created');
  return asset;
}

export async function getAssetById(id: string) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      incidents: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true, title: true, status: true, createdAt: true },
      },
    },
  });

  if (!asset) {
    throw new AppError(404, 'Asset not found', 'NOT_FOUND');
  }

  return asset;
}

export async function listAssets(query: ListAssetsQuery) {
  const { page, limit, type, status, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.AssetWhereInput = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { assetTag: { contains: search } },
      { serialNumber: { contains: search } },
    ];
  }

  const [assets, total] = await Promise.all([
    prisma.asset.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.asset.count({ where }),
  ]);

  return {
    data: assets,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateAsset(id: string, input: UpdateAssetInput) {
  const updateData: Prisma.AssetUpdateInput = {
    ...input,
    purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : undefined,
    warrantyEnd: input.warrantyEnd ? new Date(input.warrantyEnd) : undefined,
  };

  try {
    const asset = await prisma.asset.update({
      where: { id },
      data: updateData,
    });

    logger.info({ assetId: id }, 'Asset updated');
    return asset;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(404, 'Asset not found', 'NOT_FOUND');
    }
    throw err;
  }
}
