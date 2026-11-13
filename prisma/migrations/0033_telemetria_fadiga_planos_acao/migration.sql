-- Telemetria & Fadiga: validação da fadiga detectada, parada obrigatória e planos de ação (Anexo I).
-- AlterTable
ALTER TABLE "eventos_telemetria" ADD COLUMN     "parou_em_15_min" BOOLEAN,
ADD COLUMN     "plano_acao_id" UUID,
ADD COLUMN     "validacao_fadiga" VARCHAR(20),
ADD COLUMN     "validacao_motivo" TEXT,
ADD COLUMN     "validado_em" TIMESTAMP(6),
ADD COLUMN     "validado_por" VARCHAR(255);

-- CreateTable
CREATE TABLE "planos_acao_telemetria" (
    "id" UUID NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'FADIGA',
    "motorista" VARCHAR(255) NOT NULL,
    "tag_placa" VARCHAR(60),
    "linha_matriz" VARCHAR(30) NOT NULL,
    "nivel_recorrencia" INTEGER NOT NULL DEFAULT 1,
    "elegivel_prontidao" BOOLEAN,
    "medida_matriz" TEXT NOT NULL,
    "analise" TEXT,
    "acoes" JSONB NOT NULL DEFAULT '[]',
    "responsavel" VARCHAR(255),
    "prazo" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
    "conclusao" TEXT,
    "concluido_em" TIMESTAMP(6),
    "criado_por" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "planos_acao_telemetria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planos_acao_telemetria_motorista_idx" ON "planos_acao_telemetria"("motorista");

-- CreateIndex
CREATE INDEX "planos_acao_telemetria_status_idx" ON "planos_acao_telemetria"("status");

-- CreateIndex
CREATE INDEX "eventos_telemetria_plano_acao_id_idx" ON "eventos_telemetria"("plano_acao_id");

-- AddForeignKey
ALTER TABLE "eventos_telemetria" ADD CONSTRAINT "eventos_telemetria_plano_acao_id_fkey" FOREIGN KEY ("plano_acao_id") REFERENCES "planos_acao_telemetria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

