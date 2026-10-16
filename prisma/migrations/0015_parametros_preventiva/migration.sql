-- Parâmetros de preventiva por categoria de veículo e contrato.
-- Idempotente: seguro executar no Neon/Render.
CREATE TABLE IF NOT EXISTS "parametros_preventiva" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "categoria" VARCHAR(100) NOT NULL,
    "km_limite_preventiva" INTEGER NOT NULL,
    "contrato" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "parametros_preventiva_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'parametros_preventiva_categoria_contrato_key'
    ) THEN
        ALTER TABLE "parametros_preventiva"
            ADD CONSTRAINT "parametros_preventiva_categoria_contrato_key"
            UNIQUE ("categoria", "contrato");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "parametros_preventiva_categoria_idx" ON "parametros_preventiva"("categoria");

-- Sementes contratuais padrão (nunca sobrescrevem ajustes manuais).
INSERT INTO "parametros_preventiva" ("categoria", "km_limite_preventiva", "contrato")
VALUES ('VEÍCULOS LEVES', 10000, NULL), ('CAMINHÕES', 20000, NULL)
ON CONFLICT DO NOTHING;
