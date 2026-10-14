-- AlterTable
ALTER TABLE "partes_diarias" ADD COLUMN     "atualizado_por" VARCHAR(255),
ADD COLUMN     "contratante" VARCHAR(255),
ADD COLUMN     "criado_por" VARCHAR(255),
ADD COLUMN     "dia_semana" VARCHAR(20),
ADD COLUMN     "endereco_obra" TEXT,
ADD COLUMN     "horario_entrada" VARCHAR(5),
ADD COLUMN     "horario_saida" VARCHAR(5),
ADD COLUMN     "intervalo_entrada" VARCHAR(5),
ADD COLUMN     "intervalo_saida" VARCHAR(5),
ADD COLUMN     "km_final" VARCHAR(50),
ADD COLUMN     "km_inicial" VARCHAR(50),
ADD COLUMN     "numero_contrato" VARCHAR(50),
ADD COLUMN     "numero_relatorio" VARCHAR(50),
ADD COLUMN     "prazo_a_vencer" INTEGER,
ADD COLUMN     "prazo_contratual" INTEGER,
ADD COLUMN     "prazo_decorrido" INTEGER,
ADD COLUMN     "responsavel" VARCHAR(255),
ADD COLUMN     "status_relatorio" VARCHAR(20) NOT NULL DEFAULT 'PREENCHENDO',
ADD COLUMN     "turno" VARCHAR(20),
ADD COLUMN     "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "visualizacoes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "parte_diaria_mao_obra" (
    "id" UUID NOT NULL,
    "parte_id" UUID NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "funcao" VARCHAR(100),
    "horario" VARCHAR(20),
    "observacao" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parte_diaria_mao_obra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parte_diaria_equipamentos" (
    "id" UUID NOT NULL,
    "parte_id" UUID NOT NULL,
    "tag_patrimonio" VARCHAR(50),
    "descricao" VARCHAR(255) NOT NULL,
    "horimetro_inicial" VARCHAR(50),
    "horimetro_final" VARCHAR(50),
    "status" VARCHAR(50),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parte_diaria_equipamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parte_diaria_atividades" (
    "id" UUID NOT NULL,
    "parte_id" UUID NOT NULL,
    "descricao" TEXT NOT NULL,
    "local" VARCHAR(255),
    "hora_inicio" VARCHAR(5),
    "hora_fim" VARCHAR(5),
    "status" VARCHAR(50),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parte_diaria_atividades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parte_diaria_ocorrencias" (
    "id" UUID NOT NULL,
    "parte_id" UUID NOT NULL,
    "tipo" VARCHAR(100),
    "descricao" TEXT NOT NULL,
    "hora" VARCHAR(5),
    "gravidade" VARCHAR(20),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parte_diaria_ocorrencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parte_diaria_checklist" (
    "id" UUID NOT NULL,
    "parte_id" UUID NOT NULL,
    "item" VARCHAR(255) NOT NULL,
    "conforme" BOOLEAN DEFAULT true,
    "observacao" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parte_diaria_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parte_diaria_comentarios" (
    "id" UUID NOT NULL,
    "parte_id" UUID NOT NULL,
    "autor" VARCHAR(255),
    "texto" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parte_diaria_comentarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parte_diaria_fotos" (
    "id" UUID NOT NULL,
    "parte_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "legenda" VARCHAR(255),
    "public_id" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parte_diaria_fotos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parte_diaria_assinaturas" (
    "id" UUID NOT NULL,
    "parte_id" UUID NOT NULL,
    "etapa" VARCHAR(20) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "matricula" VARCHAR(50),
    "assinatura_dado" TEXT,
    "assinado_em" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parte_diaria_assinaturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parte_diaria_logs" (
    "id" UUID NOT NULL,
    "parte_id" UUID NOT NULL,
    "acao" VARCHAR(100) NOT NULL,
    "autor" VARCHAR(255),
    "detalhes" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parte_diaria_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parte_diaria_mao_obra_parte_id_idx" ON "parte_diaria_mao_obra"("parte_id");

-- CreateIndex
CREATE INDEX "parte_diaria_equipamentos_parte_id_idx" ON "parte_diaria_equipamentos"("parte_id");

-- CreateIndex
CREATE INDEX "parte_diaria_atividades_parte_id_idx" ON "parte_diaria_atividades"("parte_id");

-- CreateIndex
CREATE INDEX "parte_diaria_ocorrencias_parte_id_idx" ON "parte_diaria_ocorrencias"("parte_id");

-- CreateIndex
CREATE INDEX "parte_diaria_checklist_parte_id_idx" ON "parte_diaria_checklist"("parte_id");

-- CreateIndex
CREATE INDEX "parte_diaria_comentarios_parte_id_idx" ON "parte_diaria_comentarios"("parte_id");

-- CreateIndex
CREATE INDEX "parte_diaria_fotos_parte_id_idx" ON "parte_diaria_fotos"("parte_id");

-- CreateIndex
CREATE INDEX "parte_diaria_assinaturas_parte_id_idx" ON "parte_diaria_assinaturas"("parte_id");

-- CreateIndex
CREATE UNIQUE INDEX "parte_diaria_assinaturas_parte_id_etapa_key" ON "parte_diaria_assinaturas"("parte_id", "etapa");

-- CreateIndex
CREATE INDEX "parte_diaria_logs_parte_id_idx" ON "parte_diaria_logs"("parte_id");

-- CreateIndex
CREATE INDEX "partes_diarias_numero_relatorio_idx" ON "partes_diarias"("numero_relatorio");

-- CreateIndex
CREATE INDEX "partes_diarias_status_relatorio_idx" ON "partes_diarias"("status_relatorio");

-- AddForeignKey
ALTER TABLE "parte_diaria_mao_obra" ADD CONSTRAINT "parte_diaria_mao_obra_parte_id_fkey" FOREIGN KEY ("parte_id") REFERENCES "partes_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parte_diaria_equipamentos" ADD CONSTRAINT "parte_diaria_equipamentos_parte_id_fkey" FOREIGN KEY ("parte_id") REFERENCES "partes_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parte_diaria_atividades" ADD CONSTRAINT "parte_diaria_atividades_parte_id_fkey" FOREIGN KEY ("parte_id") REFERENCES "partes_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parte_diaria_ocorrencias" ADD CONSTRAINT "parte_diaria_ocorrencias_parte_id_fkey" FOREIGN KEY ("parte_id") REFERENCES "partes_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parte_diaria_checklist" ADD CONSTRAINT "parte_diaria_checklist_parte_id_fkey" FOREIGN KEY ("parte_id") REFERENCES "partes_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parte_diaria_comentarios" ADD CONSTRAINT "parte_diaria_comentarios_parte_id_fkey" FOREIGN KEY ("parte_id") REFERENCES "partes_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parte_diaria_fotos" ADD CONSTRAINT "parte_diaria_fotos_parte_id_fkey" FOREIGN KEY ("parte_id") REFERENCES "partes_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parte_diaria_assinaturas" ADD CONSTRAINT "parte_diaria_assinaturas_parte_id_fkey" FOREIGN KEY ("parte_id") REFERENCES "partes_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parte_diaria_logs" ADD CONSTRAINT "parte_diaria_logs_parte_id_fkey" FOREIGN KEY ("parte_id") REFERENCES "partes_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;



