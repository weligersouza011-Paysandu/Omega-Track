-- Modulo de Gestao de Usuarios (RBAC por setor + nivel).
-- Idempotente: pode ser reaplicado com seguranca (ex: migrate deploy apos aplicacao manual).
DO $$ BEGIN
    CREATE TYPE "SetorUsuario" AS ENUM ('MEIO_AMBIENTE', 'TRANSPORTE', 'GESTAO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "NivelUsuario" AS ENUM ('MASTER', 'NORMAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "TipoUsuario" AS ENUM ('ADMINISTRADOR', 'OPERACIONAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" VARCHAR(255) NOT NULL,
    "matricula" VARCHAR(50) NOT NULL,
    "contrato" VARCHAR(100),
    "tipo" "TipoUsuario" NOT NULL DEFAULT 'OPERACIONAL',
    "setor" "SetorUsuario",
    "nivel" "NivelUsuario",
    "senha_hash" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_matricula_key" ON "usuarios"("matricula");
CREATE INDEX IF NOT EXISTS "usuarios_tipo_idx" ON "usuarios"("tipo");
