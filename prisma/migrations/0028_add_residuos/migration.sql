-- Sub-módulo de Gestão de Resíduos (EcoGestão)
CREATE TABLE "residuos" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "tipo_residuos" TEXT NOT NULL,
    "numero_mtr_mid" TEXT,
    "destinacao" TEXT NOT NULL,
    "quantidade_kg_l" DOUBLE PRECISION NOT NULL,
    "mes_ano" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "residuos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "residuos_mes_ano_idx" ON "residuos"("mes_ano");
CREATE INDEX "residuos_tipo_residuos_idx" ON "residuos"("tipo_residuos");
CREATE INDEX "residuos_destinacao_idx" ON "residuos"("destinacao");
