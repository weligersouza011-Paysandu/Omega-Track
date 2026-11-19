// ============================================================================
// Ambiente de integracao com PostgreSQL DE VERDADE (PGlite = Postgres em WebAssembly):
// aplica TODAS as migrations do projeto, abre um servidor de socket e conecta o
// Prisma Client real (a mesma pilha de producao: controllers + Prisma + SQL).
// Nao precisa instalar Postgres: basta `npm install` (devDependencies).
// ============================================================================
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function portaLivre() {
  return new Promise((resolver, rejeitar) => {
    const servidor = net.createServer();
    servidor.once('error', rejeitar);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      servidor.close(() => resolver(port));
    });
  });
}

/**
 * Sobe SO o banco (PGlite + migrations + socket). `url` serve para quem precisar conectar
 * por fora (ex.: scripts de linha de comando em outro processo).
 */
export async function iniciarBanco() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const pasta = path.join(RAIZ, 'prisma', 'migrations');
  for (const nome of fs.readdirSync(pasta).filter((n) => /^\d{4}_/.test(n)).sort()) {
    await db.exec(fs.readFileSync(path.join(pasta, nome, 'migration.sql'), 'utf8'));
  }
  const porta = await portaLivre();
  const servidor = new PGLiteSocketServer({ db, port: porta, host: '127.0.0.1' });
  await servidor.start();
  return {
    db,
    url: `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres?connection_limit=1&pgbouncer=true`,
    async encerrar() {
      await servidor.stop();
      await db.close();
    },
  };
}

/**
 * @returns {{ semente: import('@prisma/client').PrismaClient, app: import('express').Express, encerrar: () => Promise<void> }}
 *   `semente` e o cliente SEM trava de contrato (para criar/conferir dados);
 *   `app` usa o cliente com a trava, como em producao.
 */
export async function iniciarAmbiente() {
  const banco = await iniciarBanco();
  process.env.DATABASE_URL = banco.url;
  const { PrismaClient } = await import('@prisma/client');
  const semente = new PrismaClient();
  globalThis.prisma = semente; // config/database.js reaproveita e aplica a trava de contrato
  const { default: app } = await import('../../src/app.js');

  return {
    semente,
    app,
    async encerrar() {
      await semente.$disconnect();
      await banco.encerrar();
    },
  };
}
