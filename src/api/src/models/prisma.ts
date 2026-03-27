import { PrismaClient } from '@prisma/client';
import { logger } from '../config';

const prisma = new PrismaClient({
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' },
  ],
});

prisma.$on('error', (e) => {
  logger.error({ target: e.target }, e.message);
});

prisma.$on('warn', (e) => {
  logger.warn({ target: e.target }, e.message);
});

export { prisma };
