-- Dados técnicos editáveis na ficha do veículo (aba Visão Geral & Dados Técnicos).
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "chassi" VARCHAR(50);
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "renavam" VARCHAR(50);
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "cor" VARCHAR(50);
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "ano_fabricacao" INTEGER;
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "ano_modelo" INTEGER;
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "km_inicial" INTEGER;
ALTER TABLE "mob_desmob" ADD COLUMN IF NOT EXISTS "combustivel" VARCHAR(50);
