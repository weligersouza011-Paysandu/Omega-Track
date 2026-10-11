import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

async function testConnection() {
  try {
    await prisma.$connect();
    console.log('[DB] Conexao com PostgreSQL/Neon estabelecida com sucesso.');
  } catch (error) {
    console.error('[DB] Erro ao conectar no banco de dados:', error.message);
    process.exit(1);
  }
}

export { prisma, testConnection };
export default prisma;
