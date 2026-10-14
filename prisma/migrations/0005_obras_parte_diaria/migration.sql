-- AlterTable
ALTER TABLE "partes_diarias" ADD COLUMN     "obra_id" UUID,
ADD COLUMN     "planejador" VARCHAR(255);

-- CreateTable
CREATE TABLE "obras" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "numero_contrato" VARCHAR(50),
    "contratante" VARCHAR(255) NOT NULL DEFAULT 'Vale',
    "gestao" VARCHAR(255),
    "planejador" VARCHAR(255),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "obras_ativo_idx" ON "obras"("ativo");

-- CreateIndex
CREATE INDEX "obras_nome_idx" ON "obras"("nome");

-- AddForeignKey
ALTER TABLE "partes_diarias" ADD CONSTRAINT "partes_diarias_obra_id_fkey" FOREIGN KEY ("obra_id") REFERENCES "obras"("id") ON DELETE SET NULL ON UPDATE CASCADE;


