-- Telemetria: trajeto por veiculo (placa/TAG exata + periodo) sem varrer a tabela inteira.
-- CreateIndex
CREATE INDEX "eventos_telemetria_tag_placa_data_hora_idx" ON "eventos_telemetria"("tag_placa", "data_hora");

-- CreateIndex
CREATE INDEX "eventos_telemetria_tag_data_hora_idx" ON "eventos_telemetria"("tag", "data_hora");
