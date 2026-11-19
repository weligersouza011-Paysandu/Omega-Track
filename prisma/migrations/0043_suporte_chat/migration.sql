-- Chat de suporte: o usuario fala direto com o desenvolvedor (todos os Master recebem).
-- Cada conversa e identificada pela matricula de quem pediu ajuda. Sem FK: apagar o
-- usuario nao apaga o historico da conversa (guarda nome/matricula em texto).
CREATE TABLE "suporte_mensagens" (
    "id" UUID NOT NULL,
    "conversa_matricula" VARCHAR(50) NOT NULL,
    "conversa_nome" VARCHAR(255) NOT NULL,
    "conversa_contrato" VARCHAR(3),
    "de_dev" BOOLEAN NOT NULL DEFAULT false,
    "autor_nome" VARCHAR(255) NOT NULL,
    "autor_matricula" VARCHAR(50) NOT NULL,
    "texto" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suporte_mensagens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "suporte_mensagens_conversa_matricula_created_at_idx" ON "suporte_mensagens"("conversa_matricula", "created_at");
CREATE INDEX "suporte_mensagens_de_dev_lida_idx" ON "suporte_mensagens"("de_dev", "lida");
