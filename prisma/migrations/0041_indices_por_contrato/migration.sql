-- 0041 - Indices compostos para as listagens/filtros por contrato (frota por status,
-- obras ativas, e lancamentos por mes), que agora sempre filtram por contrato.
CREATE INDEX "mob_desmob_contrato_status_idx" ON "mob_desmob"("contrato", "status");
CREATE INDEX "obras_contrato_ativo_idx" ON "obras"("contrato", "ativo");
CREATE INDEX "abastecimentos_contrato_mes_referencia_idx" ON "abastecimentos"("contrato", "mes_referencia");
CREATE INDEX "residuos_contrato_mes_ano_idx" ON "residuos"("contrato", "mes_ano");
CREATE INDEX "consumo_agua_contrato_ano_mes_idx" ON "consumo_agua"("contrato", "ano_mes");
