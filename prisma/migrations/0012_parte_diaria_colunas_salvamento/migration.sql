-- Garante que a tabela `partes_diarias` possui todas as colunas exigidas pelo
-- formulário da Parte Diária (idempotente: seguro executar no Neon/Render).
-- Coleções (mao_obra, equipamentos, atividades, ocorrencias, checklist, fotos,
-- assinaturas, logs) vivem em tabelas relacionais — nenhum JSONB é necessário.

-- Status operacional do dia (ex: 'Operação', 'Manutenção Corretiva', ...)
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "status_operacional" VARCHAR(50) NOT NULL DEFAULT 'Operação';

-- Status do fluxo de aprovação (ex: 'Em Preenchimento', 'Finalizado pelo Operador', ...)
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "status_aprovacao" VARCHAR(50) NOT NULL DEFAULT 'Em Preenchimento';

-- Quilometragem (texto livre no formulário)
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "km_inicial" VARCHAR(50);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "km_final" VARCHAR(50);

-- Cabeçalho / vínculo com obras
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "numero_contrato" VARCHAR(50);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "contratante" VARCHAR(255);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "responsavel" VARCHAR(255);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "planejador" VARCHAR(255);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "obra_id" UUID;
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "horario_entrada" VARCHAR(5);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "horario_saida" VARCHAR(5);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "intervalo_entrada" VARCHAR(5);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "intervalo_saida" VARCHAR(5);
ALTER TABLE "partes_diarias" ADD COLUMN IF NOT EXISTS "turno" VARCHAR(20);

-- Backfill conservador (somente onde ainda está no default/NULL)
UPDATE "partes_diarias" SET "status_operacional" = 'Operação'
WHERE "status_operacional" IS NULL OR "status_operacional" = '';

UPDATE "partes_diarias" SET "status_aprovacao" = 'Em Preenchimento'
WHERE "status_aprovacao" IS NULL OR "status_aprovacao" = '';

-- Índices de leitura do fluxo
CREATE INDEX IF NOT EXISTS "partes_diarias_status_operacional_idx" ON "partes_diarias"("status_operacional");
CREATE INDEX IF NOT EXISTS "partes_diarias_status_aprovacao_idx" ON "partes_diarias"("status_aprovacao");
