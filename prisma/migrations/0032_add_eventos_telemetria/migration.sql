-- Telemetria & Fadiga (PGS-007245 Rev. 03): eventos de conduta da telemetria
-- veicular e do detector de fadiga, classificados pelo Anexo I.
-- CreateTable
CREATE TABLE "eventos_telemetria" (
    "id" UUID NOT NULL,
    "tag_placa" VARCHAR(60) NOT NULL,
    "tag" VARCHAR(50),
    "motorista" VARCHAR(255),
    "data_hora" TIMESTAMP(6) NOT NULL,
    "evento" VARCHAR(60) NOT NULL,
    "valor" DOUBLE PRECISION,
    "limite" DOUBLE PRECISION,
    "localizacao" VARCHAR(500),
    "severidade" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    "status_tratativa" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "classificacao" VARCHAR(5),
    "percentual_excesso" DOUBLE PRECISION,
    "duracao_s" INTEGER,
    "cerca" VARCHAR(60),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "link_mapa" VARCHAR(500),
    "evento_original" VARCHAR(500),
    "origem" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "arquivo_origem" VARCHAR(255),
    "chave_unica" VARCHAR(64) NOT NULL,
    "prazo_tratativa" DATE,
    "medida_aplicada" TEXT,
    "observacao_tratativa" TEXT,
    "tratado_por" VARCHAR(255),
    "tratado_em" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "eventos_telemetria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "eventos_telemetria_chave_unica_key" ON "eventos_telemetria"("chave_unica");

-- CreateIndex
CREATE INDEX "eventos_telemetria_tag_placa_idx" ON "eventos_telemetria"("tag_placa");

-- CreateIndex
CREATE INDEX "eventos_telemetria_tag_idx" ON "eventos_telemetria"("tag");

-- CreateIndex
CREATE INDEX "eventos_telemetria_evento_idx" ON "eventos_telemetria"("evento");

-- CreateIndex
CREATE INDEX "eventos_telemetria_severidade_idx" ON "eventos_telemetria"("severidade");

-- CreateIndex
CREATE INDEX "eventos_telemetria_data_hora_idx" ON "eventos_telemetria"("data_hora");

-- CreateIndex
CREATE INDEX "eventos_telemetria_motorista_evento_data_hora_idx" ON "eventos_telemetria"("motorista", "evento", "data_hora");

-- CreateIndex
CREATE INDEX "eventos_telemetria_status_tratativa_prazo_tratativa_idx" ON "eventos_telemetria"("status_tratativa", "prazo_tratativa");

