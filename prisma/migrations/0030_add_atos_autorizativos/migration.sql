-- Sub-módulo de Atos Autorizativos / Licenças e Autorizações (EcoGestão)
CREATE TABLE "atos_autorizativos" (
    "id" TEXT NOT NULL,
    "descricao_do_tipo_de_servico" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "licenca" TEXT NOT NULL,
    "validade" TIMESTAMP(3) NOT NULL,
    "farol_de_vencimentos" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "atos_autorizativos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "atos_autorizativos_status_idx" ON "atos_autorizativos"("status");
CREATE INDEX "atos_autorizativos_validade_idx" ON "atos_autorizativos"("validade");
CREATE INDEX "atos_autorizativos_farol_de_vencimentos_idx" ON "atos_autorizativos"("farol_de_vencimentos");
