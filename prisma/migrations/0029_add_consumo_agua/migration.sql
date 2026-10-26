-- Sub-módulo de Consumo de Água Potável (EcoGestão)
CREATE TABLE "consumo_agua" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "pontos_captacao" TEXT NOT NULL,
    "consumo_m3" DOUBLE PRECISION NOT NULL,
    "ultima_atualizacao" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "ano_mes" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumo_agua_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consumo_agua_ano_mes_idx" ON "consumo_agua"("ano_mes");
CREATE INDEX "consumo_agua_pontos_captacao_idx" ON "consumo_agua"("pontos_captacao");
