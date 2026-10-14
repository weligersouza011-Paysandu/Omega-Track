-- Campos de trilha da desmobilizacao (responsavel + observacao/motivo).
ALTER TABLE "mob_desmob" ADD COLUMN "responsavel_desmob" VARCHAR(255);
ALTER TABLE "mob_desmob" ADD COLUMN "observacao_desmob" TEXT;
