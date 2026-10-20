-- Observacao curta do apontamento rapido da Matriz Calendario.
-- Idempotente: ADD COLUMN IF NOT EXISTS preserva bases ja migradas.
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "observacao_rapida" TEXT;
