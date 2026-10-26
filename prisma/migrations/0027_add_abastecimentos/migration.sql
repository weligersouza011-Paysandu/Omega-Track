-- Controle de combustível (operacional/ambiental, sem custos financeiros).
-- O vínculo com a frota é feito por placa/tag, sem FK, para preservar o histórico.
CREATE TABLE "abastecimentos" (
  "id" UUID NOT NULL,
  "codigo_transacao" VARCHAR(100),
  "forma_pagamento" VARCHAR(50),
  "data_transacao" TIMESTAMP(6) NOT NULL,
  "placa" VARCHAR(20) NOT NULL,
  "tag" VARCHAR(50),
  "modelo_veiculo" VARCHAR(100),
  "nome_motorista" VARCHAR(255),
  "tipo_combustivel" VARCHAR(100) NOT NULL,
  "litros" DOUBLE PRECISION NOT NULL,
  "hodometro_horimetro" DOUBLE PRECISION,
  "km_rodados_horas" DOUBLE PRECISION,
  "km_por_litro" DOUBLE PRECISION,
  "emissao_co2_kg" DOUBLE PRECISION,
  "estabelecimento" VARCHAR(255),
  "contrato" VARCHAR(100),
  "mes_referencia" VARCHAR(7) NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "abastecimentos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "abastecimentos_placa_idx" ON "abastecimentos"("placa");
CREATE INDEX "abastecimentos_mes_referencia_idx" ON "abastecimentos"("mes_referencia");
CREATE INDEX "abastecimentos_tipo_combustivel_idx" ON "abastecimentos"("tipo_combustivel");
