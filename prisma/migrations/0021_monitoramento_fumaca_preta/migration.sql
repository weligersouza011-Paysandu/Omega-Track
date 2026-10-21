-- CreateTable
CREATE TABLE "monitoramentos_fumaca_preta" (
    "id" UUID NOT NULL,
    "tag" VARCHAR(50) NOT NULL,
    "data_medicao" DATE NOT NULL,
    "validade" DATE NOT NULL,
    "observacao" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitoramentos_fumaca_preta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monitoramentos_fumaca_preta_tag_key" ON "monitoramentos_fumaca_preta"("tag");

-- CreateIndex
CREATE INDEX "monitoramentos_fumaca_preta_validade_idx" ON "monitoramentos_fumaca_preta"("validade");

-- AddForeignKey
ALTER TABLE "monitoramentos_fumaca_preta" ADD CONSTRAINT "monitoramentos_fumaca_preta_tag_fkey" FOREIGN KEY ("tag") REFERENCES "mob_desmob"("tag") ON DELETE CASCADE ON UPDATE CASCADE;
