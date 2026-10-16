-- Obra opcional fora de Operação (manutenção/parada sem obra vinculada).
-- Idempotente: DROP NOT NULL em coluna já anulável é no-op no PostgreSQL.
ALTER TABLE "partes_diarias" ALTER COLUMN "obra" DROP NOT NULL;
