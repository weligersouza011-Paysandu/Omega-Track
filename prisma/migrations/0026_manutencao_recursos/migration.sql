CREATE TABLE "manutencao_recursos" (
  "id" UUID NOT NULL,
  "tag" VARCHAR(50) NOT NULL,
  "tipo" VARCHAR(20) NOT NULL,
  "data_saida" DATE NOT NULL,
  "previsao_retorno" DATE NOT NULL,
  "descricao" TEXT NOT NULL,
  "data_retorno" DATE,
  "registrado_por" VARCHAR(50),
  "retornado_por" VARCHAR(50),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manutencao_recursos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manutencao_recursos_tipo_check" CHECK ("tipo" IN ('PREVENTIVA', 'CORRETIVA')),
  CONSTRAINT "manutencao_recursos_datas_check" CHECK (
    "previsao_retorno" >= "data_saida"
    AND ("data_retorno" IS NULL OR "data_retorno" >= "data_saida")
  ),
  CONSTRAINT "manutencao_recursos_descricao_check" CHECK (
    char_length(btrim("descricao")) BETWEEN 1 AND 2000
  )
);

CREATE INDEX "manutencao_recursos_tag_data_saida_idx" ON "manutencao_recursos"("tag", "data_saida");
CREATE UNIQUE INDEX "manutencao_recursos_tag_aberta_key" ON "manutencao_recursos"("tag") WHERE "data_retorno" IS NULL;

ALTER TABLE "manutencao_recursos"
  ADD CONSTRAINT "manutencao_recursos_tag_fkey"
  FOREIGN KEY ("tag") REFERENCES "mob_desmob"("tag") ON DELETE CASCADE ON UPDATE CASCADE;
