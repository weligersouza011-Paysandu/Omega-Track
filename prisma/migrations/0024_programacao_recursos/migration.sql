CREATE TABLE "programacao_recursos" (
  "id" UUID NOT NULL,
  "tag" VARCHAR(50) NOT NULL,
  "obra_id" UUID NOT NULL,
  "data" DATE NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "programacao_recursos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "programacao_recursos_tag_data_key" ON "programacao_recursos"("tag", "data");
CREATE INDEX "programacao_recursos_data_idx" ON "programacao_recursos"("data");
CREATE INDEX "programacao_recursos_obra_id_data_idx" ON "programacao_recursos"("obra_id", "data");

ALTER TABLE "programacao_recursos"
  ADD CONSTRAINT "programacao_recursos_tag_fkey"
  FOREIGN KEY ("tag") REFERENCES "mob_desmob"("tag") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "programacao_recursos"
  ADD CONSTRAINT "programacao_recursos_obra_id_fkey"
  FOREIGN KEY ("obra_id") REFERENCES "obras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
