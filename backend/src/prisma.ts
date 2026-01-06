import { PrismaClient } from '@prisma/client';

// Single Prisma client instance for the backend.
export const prisma = new PrismaClient();
