-- ============================================================================
-- 0039 - Base multi-contrato.
-- Contrato = 3 digitos (ex.: 251). Cada usuario pertence a UM contrato.
-- TODOS os dados existentes pertencem ao contrato 251 (decisao do negocio).
-- Os valores antigos (texto livre) sao copiados para contrato_legado_backup
-- antes de serem padronizados. Os DEFAULTs '251' sao transitorios: mantem o app
-- atual funcionando ate o backend passar a gravar o contrato do usuario
-- (fase seguinte), quando serao removidos.
-- ============================================================================

-- 1) Backup dos valores antigos --------------------------------------------
CREATE TABLE "contrato_legado_backup" (
    "id" SERIAL NOT NULL,
    "tabela" VARCHAR(60) NOT NULL,
    "chave" TEXT NOT NULL,
    "contrato_antigo" TEXT,
    "dados" JSONB,
    "criado_em" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contrato_legado_backup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "contrato_legado_backup_tabela_idx" ON "contrato_legado_backup"("tabela");

INSERT INTO "contrato_legado_backup" ("tabela", "chave", "contrato_antigo")
SELECT 'usuarios', "id"::text, "contrato" FROM "usuarios" WHERE "contrato" IS NOT NULL;
INSERT INTO "contrato_legado_backup" ("tabela", "chave", "contrato_antigo")
SELECT 'mob_desmob', "tag", "contrato" FROM "mob_desmob" WHERE "contrato" IS NOT NULL;
INSERT INTO "contrato_legado_backup" ("tabela", "chave", "contrato_antigo")
SELECT 'abastecimentos', "id"::text, "contrato" FROM "abastecimentos" WHERE "contrato" IS NOT NULL;
INSERT INTO "contrato_legado_backup" ("tabela", "chave", "contrato_antigo", "dados")
SELECT 'parametros_preventiva', "id"::text, "contrato", to_jsonb(p.*) FROM "parametros_preventiva" p WHERE "contrato" IS NOT NULL;

-- 2) Colunas que ja existiam como texto livre -> 3 digitos, NOT NULL --------
UPDATE "usuarios" SET "contrato" = '251';
ALTER TABLE "usuarios" ALTER COLUMN "contrato" SET DATA TYPE VARCHAR(3),
  ALTER COLUMN "contrato" SET DEFAULT '251',
  ALTER COLUMN "contrato" SET NOT NULL;
UPDATE "mob_desmob" SET "contrato" = '251';
ALTER TABLE "mob_desmob" ALTER COLUMN "contrato" SET DATA TYPE VARCHAR(3),
  ALTER COLUMN "contrato" SET DEFAULT '251',
  ALTER COLUMN "contrato" SET NOT NULL;
UPDATE "abastecimentos" SET "contrato" = '251';
ALTER TABLE "abastecimentos" ALTER COLUMN "contrato" SET DATA TYPE VARCHAR(3),
  ALTER COLUMN "contrato" SET DEFAULT '251',
  ALTER COLUMN "contrato" SET NOT NULL;

-- Parametros de preventiva: contrato NULL continua sendo a regra global. Ao
-- unificar tudo em 251, mantem-se um unico parametro por categoria (o mais
-- recente); os removidos ficam em contrato_legado_backup.dados.
DELETE FROM "parametros_preventiva" p
 USING "parametros_preventiva" q
 WHERE p."contrato" IS NOT NULL AND q."contrato" IS NOT NULL
   AND p."categoria" = q."categoria"
   AND (p."updated_at" < q."updated_at" OR (p."updated_at" = q."updated_at" AND p."id" < q."id"));
UPDATE "parametros_preventiva" SET "contrato" = '251' WHERE "contrato" IS NOT NULL;
ALTER TABLE "parametros_preventiva" ALTER COLUMN "contrato" SET DATA TYPE VARCHAR(3);

-- 3) Novas colunas (tudo que existe hoje e do contrato 251) ------------------
ALTER TABLE "veiculos_terceiros" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "obras" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "programacao_recursos" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "programacao_recursos_terceiros" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "partes_diarias" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "eventos_telemetria" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "planos_acao_telemetria" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "residuos" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "consumo_agua" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "atos_autorizativos" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';
ALTER TABLE "produtos_quimicos" ADD COLUMN "contrato" VARCHAR(3) NOT NULL DEFAULT '251';

-- Log de atividades: contrato do autor (nulo = acao do sistema).
ALTER TABLE "logs_atividade" ADD COLUMN "contrato" VARCHAR(3);
UPDATE "logs_atividade" SET "contrato" = '251';

-- Obra: usuario Planejador vinculado (matricula em texto: sobrevive a exclusao do usuario).
ALTER TABLE "obras" ADD COLUMN "planejador_matricula" VARCHAR(50);

-- 4) Garantia no banco: exatamente 3 digitos --------------------------------
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "mob_desmob" ADD CONSTRAINT "mob_desmob_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "veiculos_terceiros" ADD CONSTRAINT "veiculos_terceiros_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "obras" ADD CONSTRAINT "obras_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "programacao_recursos" ADD CONSTRAINT "programacao_recursos_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "programacao_recursos_terceiros" ADD CONSTRAINT "programacao_recursos_terceiros_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "partes_diarias" ADD CONSTRAINT "partes_diarias_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "eventos_telemetria" ADD CONSTRAINT "eventos_telemetria_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "planos_acao_telemetria" ADD CONSTRAINT "planos_acao_telemetria_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "residuos" ADD CONSTRAINT "residuos_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "consumo_agua" ADD CONSTRAINT "consumo_agua_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "atos_autorizativos" ADD CONSTRAINT "atos_autorizativos_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "produtos_quimicos" ADD CONSTRAINT "produtos_quimicos_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$');
ALTER TABLE "parametros_preventiva" ADD CONSTRAINT "parametros_preventiva_contrato_3_digitos" CHECK ("contrato" IS NULL OR "contrato" ~ '^[0-9]{3}$');
ALTER TABLE "logs_atividade" ADD CONSTRAINT "logs_atividade_contrato_3_digitos" CHECK ("contrato" IS NULL OR "contrato" ~ '^[0-9]{3}$');

-- 5) Historico de contrato por veiculo --------------------------------------
CREATE TABLE "veiculo_contrato_historico" (
    "id" UUID NOT NULL,
    "tag" VARCHAR(50) NOT NULL,
    "contrato" VARCHAR(3) NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "vigente_ate" DATE,
    "alterado_por" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "veiculo_contrato_historico_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "veiculo_contrato_historico_contrato_3_digitos" CHECK ("contrato" ~ '^[0-9]{3}$')
);
CREATE INDEX "veiculo_contrato_historico_tag_vigente_desde_idx" ON "veiculo_contrato_historico"("tag", "vigente_desde");
CREATE INDEX "veiculo_contrato_historico_contrato_idx" ON "veiculo_contrato_historico"("contrato");

-- Um registro inicial por veiculo existente (inclusive os excluidos), vigente desde a MOB.
INSERT INTO "veiculo_contrato_historico" ("id", "tag", "contrato", "vigente_desde", "alterado_por")
SELECT gen_random_uuid(), "tag", '251', COALESCE("data_mob", "created_at"::date), 'migracao multi-contrato'
  FROM "mob_desmob";

-- 6) Indices por contrato ---------------------------------------------------
CREATE INDEX "usuarios_contrato_idx" ON "usuarios"("contrato");
CREATE INDEX "mob_desmob_contrato_idx" ON "mob_desmob"("contrato");
CREATE INDEX "abastecimentos_contrato_idx" ON "abastecimentos"("contrato");
CREATE INDEX "veiculos_terceiros_contrato_idx" ON "veiculos_terceiros"("contrato");
CREATE INDEX "obras_contrato_idx" ON "obras"("contrato");
CREATE INDEX "programacao_recursos_contrato_idx" ON "programacao_recursos"("contrato");
CREATE INDEX "programacao_recursos_terceiros_contrato_idx" ON "programacao_recursos_terceiros"("contrato");
CREATE INDEX "partes_diarias_contrato_idx" ON "partes_diarias"("contrato");
CREATE INDEX "eventos_telemetria_contrato_idx" ON "eventos_telemetria"("contrato");
CREATE INDEX "planos_acao_telemetria_contrato_idx" ON "planos_acao_telemetria"("contrato");
CREATE INDEX "residuos_contrato_idx" ON "residuos"("contrato");
CREATE INDEX "consumo_agua_contrato_idx" ON "consumo_agua"("contrato");
CREATE INDEX "atos_autorizativos_contrato_idx" ON "atos_autorizativos"("contrato");
CREATE INDEX "produtos_quimicos_contrato_idx" ON "produtos_quimicos"("contrato");
CREATE INDEX "logs_atividade_contrato_idx" ON "logs_atividade"("contrato");
CREATE INDEX "partes_diarias_contrato_data_idx" ON "partes_diarias"("contrato", "data");
CREATE INDEX "eventos_telemetria_contrato_data_hora_idx" ON "eventos_telemetria"("contrato", "data_hora");
