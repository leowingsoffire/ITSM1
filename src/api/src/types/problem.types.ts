import { z } from 'zod';

export const createProblemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  impact: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  category: z.string().max(100).optional(),
  assignedToId: z.string().uuid().optional(),
  assignedTeamId: z.string().uuid().optional(),
});

export const updateProblemSchema = createProblemSchema.partial().extend({
  status: z.enum([
    'NEW', 'INVESTIGATING', 'ROOT_CAUSE_IDENTIFIED',
    'KNOWN_ERROR', 'RESOLVED', 'CLOSED',
  ]).optional(),
  rootCause: z.string().max(5000).optional(),
  workaround: z.string().max(5000).optional(),
  isKnownError: z.boolean().optional(),
});

export const listProblemsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum([
    'NEW', 'INVESTIGATING', 'ROOT_CAUSE_IDENTIFIED',
    'KNOWN_ERROR', 'RESOLVED', 'CLOSED',
  ]).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  search: z.string().max(200).optional(),
});

export type CreateProblemInput = z.infer<typeof createProblemSchema>;
export type UpdateProblemInput = z.infer<typeof updateProblemSchema>;
export type ListProblemsQuery = z.infer<typeof listProblemsQuerySchema>;
