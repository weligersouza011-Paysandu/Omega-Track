-- Parâmetros de manutenção preventiva por veículo.
-- km_limite_preventiva: intervalo (km) entre preventivas (padrão 10.000).
-- km_ultima_preventiva: leitura do odômetro na última preventiva realizada.
-- Idempotente: seguro executar no Neon/Render.
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "km_limite_preventiva" INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "km_ultima_preventiva" INTEGER;
