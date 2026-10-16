-- Herança automática do odômetro: acelera a busca da última `km_final`
-- por veículo (GET /api/partes-diarias/ultima-km?tag=TAG), ordenada por
-- (data DESC, created_at DESC). Idempotente: seguro executar no Neon/Render.
CREATE INDEX IF NOT EXISTS "partes_diarias_tag_data_created_idx"
  ON "partes_diarias"("tag", "data" DESC, "created_at" DESC);
