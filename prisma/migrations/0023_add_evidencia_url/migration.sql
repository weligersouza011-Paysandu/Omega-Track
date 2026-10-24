-- A coluna existe no schema Prisma, mas nao foi criada pelas migracoes anteriores.
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "evidencia_url" TEXT;
