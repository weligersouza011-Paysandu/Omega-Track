-- Aderencia a Programacao: obra programada na Parte Diaria, categorias e justificativa de desvio.
-- AlterTable
ALTER TABLE "partes_diarias" ADD COLUMN     "categoria_desvio_id" UUID,
ADD COLUMN     "justificativa_desvio" TEXT,
ADD COLUMN     "obra_programada_id" UUID;

-- CreateTable
CREATE TABLE "categorias_desvio_programacao" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_desvio_programacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_desvio_programacao_nome_key" ON "categorias_desvio_programacao"("nome");

-- CreateIndex
CREATE INDEX "categorias_desvio_programacao_ativo_idx" ON "categorias_desvio_programacao"("ativo");

-- CreateIndex
CREATE INDEX "partes_diarias_data_aderencia_idx" ON "partes_diarias"("data", "aderencia");

-- CreateIndex
CREATE INDEX "partes_diarias_categoria_desvio_id_idx" ON "partes_diarias"("categoria_desvio_id");

-- AddForeignKey
ALTER TABLE "partes_diarias" ADD CONSTRAINT "partes_diarias_obra_programada_id_fkey" FOREIGN KEY ("obra_programada_id") REFERENCES "obras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partes_diarias" ADD CONSTRAINT "partes_diarias_categoria_desvio_id_fkey" FOREIGN KEY ("categoria_desvio_id") REFERENCES "categorias_desvio_programacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Categorias iniciais (parametrizaveis depois pelo admin).
INSERT INTO "categorias_desvio_programacao" ("id", "nome") VALUES
    (gen_random_uuid(), 'Solicitação Urgente do Cliente'),
    (gen_random_uuid(), 'Manutenção Corretiva'),
    (gen_random_uuid(), 'Falta de Frente de Serviço'),
    (gen_random_uuid(), 'Apoio Operacional Extra'),
    (gen_random_uuid(), 'Erro de Programação')
ON CONFLICT ("nome") DO NOTHING;
