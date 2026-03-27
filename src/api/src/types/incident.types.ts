import { z } from 'zod';

export const createIncidentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  impact: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  category: z.string().max(100).optional(),
  subcategory: z.string().max(100).optional(),
  assignedToId: z.string().uuid().optional(),
  assignedTeamId: z.string().uuid().optional(),
  relatedAssetId: z.string().uuid().optional(),
});

export const updateIncidentSchema = createIncidentSchema.partial().extend({
  status: z.enum(['NEW', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED']).optional(),
});

export const listIncidentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['NEW', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED']).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  assignedToId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
