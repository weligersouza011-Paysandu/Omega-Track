-- 0040 - Remove o DEFAULT '251' transitorio da 0039: a aplicacao passa a gravar o contrato
-- do usuario (ou do veiculo) em todo registro novo. Esquecer de informar o contrato
-- agora falha na hora em vez de cair silenciosamente no contrato 251.
ALTER TABLE "mob_desmob" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "partes_diarias" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "obras" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "programacao_recursos" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "veiculos_terceiros" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "programacao_recursos_terceiros" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "abastecimentos" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "residuos" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "consumo_agua" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "atos_autorizativos" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "produtos_quimicos" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "eventos_telemetria" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "planos_acao_telemetria" ALTER COLUMN "contrato" DROP DEFAULT;
ALTER TABLE "usuarios" ALTER COLUMN "contrato" DROP DEFAULT;
