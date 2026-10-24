import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = globalThis.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (!globalThis.prisma) {
  globalThis.prisma = prisma;
}

async function testConnection(maxRetries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      console.log('[DB] Conexao com PostgreSQL/Neon estabelecida com sucesso.');
      return;
    } catch (error) {
      console.warn(`[DB] Tentativa ${attempt}/${maxRetries} falhou:`, error.message);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        console.error('[DB] Erro fatal ao conectar no banco de dados:', error.message);
        process.exit(1);
      }
    }
  }
}

export { prisma, testConnection };
export default prisma;
