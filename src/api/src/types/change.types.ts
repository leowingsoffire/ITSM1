import { z } from 'zod';

export const createChangeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  type: z.enum(['STANDARD', 'NORMAL', 'EMERGENCY']).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  risk: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  impact: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  category: z.string().max(100).optional(),
  reason: z.string().max(2000).optional(),
  implementationPlan: z.string().max(5000).optional(),
  backoutPlan: z.string().max(5000).optional(),
  testPlan: z.string().max(5000).optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  assignedToId: z.string().uuid().optional(),
  assignedTeamId: z.string().uuid().optional(),
});

export const updateChangeSchema = createChangeSchema.partial().extend({
  status: z.enum([
    'NEW', 'PLANNING', 'AWAITING_APPROVAL', 'APPROVED',
    'SCHEDULED', 'IMPLEMENTING', 'COMPLETED', 'FAILED', 'CANCELLED',
  ]).optional(),
  actualStart: z.string().datetime().optional(),
  actualEnd: z.string().datetime().optional(),
});

export const listChangesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum([
    'NEW', 'PLANNING', 'AWAITING_APPROVAL', 'APPROVED',
    'SCHEDULED', 'IMPLEMENTING', 'COMPLETED', 'FAILED', 'CANCELLED',
  ]).optional(),
  type: z.enum(['STANDARD', 'NORMAL', 'EMERGENCY']).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  search: z.string().max(200).optional(),
});

export type CreateChangeInput = z.infer<typeof createChangeSchema>;
export type UpdateChangeInput = z.infer<typeof updateChangeSchema>;
export type ListChangesQuery = z.infer<typeof listChangesQuerySchema>;
