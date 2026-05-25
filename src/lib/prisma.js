// Singleton PrismaClient — avoid "too many clients" in dev nodemon reloads.
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__sghPrisma__ ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__sghPrisma__ = prisma;
}

module.exports = prisma;
