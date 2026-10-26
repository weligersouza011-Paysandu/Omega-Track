-- Sub-módulo de Tratamento de Produtos Químicos (EcoGestão)
CREATE TABLE "produtos_quimicos" (
    "id" TEXT NOT NULL,
    "nome_produto" TEXT NOT NULL,
    "fds_fispq" TEXT,
    "marca_produto" TEXT,
    "substancias_composicao" TEXT,
    "enquadramento_produto" TEXT NOT NULL DEFAULT 'PERIGOSO',
    "validade_produto" TIMESTAMP(3),
    "local_armazenamento" TEXT,
    "inflamavel" BOOLEAN NOT NULL DEFAULT false,
    "piroforico" BOOLEAN NOT NULL DEFAULT false,
    "explosivo" BOOLEAN NOT NULL DEFAULT false,
    "oxidante" BOOLEAN NOT NULL DEFAULT false,
    "corrosivo" BOOLEAN NOT NULL DEFAULT false,
    "toxico" BOOLEAN NOT NULL DEFAULT false,
    "radioativo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produtos_quimicos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "produtos_quimicos_enquadramento_produto_idx" ON "produtos_quimicos"("enquadramento_produto");
CREATE INDEX "produtos_quimicos_validade_produto_idx" ON "produtos_quimicos"("validade_produto");
