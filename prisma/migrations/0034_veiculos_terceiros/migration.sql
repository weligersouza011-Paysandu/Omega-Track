-- Veiculos Terceiros: cadastro isolado da frota propria, usado apenas na Programacao de Recursos.
-- CreateTable
CREATE TABLE "veiculos_terceiros" (
    "id" UUID NOT NULL,
    "tag" VARCHAR(50) NOT NULL,
    "tipo" VARCHAR(100) NOT NULL,
    "empresa_terceira" VARCHAR(255),
    "placa" VARCHAR(20),
    "modelo" VARCHAR(100),
    "foto_url" TEXT,
    "observacao" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "veiculos_terceiros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programacao_recursos_terceiros" (
    "id" UUID NOT NULL,
    "veiculo_terceiro_id" UUID NOT NULL,
    "obra_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "operador_matricula" VARCHAR(50),
    "operador_nome" VARCHAR(255),
    "supervisor_matricula" VARCHAR(50),
    "supervisor_nome" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programacao_recursos_terceiros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "veiculos_terceiros_tag_key" ON "veiculos_terceiros"("tag");
CREATE INDEX "veiculos_terceiros_tipo_idx" ON "veiculos_terceiros"("tipo");
CREATE UNIQUE INDEX "programacao_recursos_terceiros_veiculo_terceiro_id_data_key" ON "programacao_recursos_terceiros"("veiculo_terceiro_id", "data");
CREATE INDEX "programacao_recursos_terceiros_data_idx" ON "programacao_recursos_terceiros"("data");
CREATE INDEX "programacao_recursos_terceiros_obra_id_data_idx" ON "programacao_recursos_terceiros"("obra_id", "data");

-- AddForeignKey
ALTER TABLE "programacao_recursos_terceiros" ADD CONSTRAINT "programacao_recursos_terceiros_veiculo_terceiro_id_fkey" FOREIGN KEY ("veiculo_terceiro_id") REFERENCES "veiculos_terceiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "programacao_recursos_terceiros" ADD CONSTRAINT "programacao_recursos_terceiros_obra_id_fkey" FOREIGN KEY ("obra_id") REFERENCES "obras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
