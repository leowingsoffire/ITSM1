import { z } from 'zod';

export const createAssetSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['SERVER', 'WORKSTATION', 'LAPTOP', 'NETWORK_DEVICE', 'PRINTER', 'MOBILE_DEVICE', 'SOFTWARE', 'OTHER']),
  manufacturer: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  serialNumber: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  purchaseDate: z.string().optional(),
  warrantyEnd: z.string().optional(),
});

export const updateAssetSchema = createAssetSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'RETIRED', 'MAINTENANCE']).optional(),
});

export const listAssetsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  type: z.enum(['SERVER', 'WORKSTATION', 'LAPTOP', 'NETWORK_DEVICE', 'PRINTER', 'MOBILE_DEVICE', 'SOFTWARE', 'OTHER']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'RETIRED', 'MAINTENANCE']).optional(),
  search: z.string().max(200).optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;
