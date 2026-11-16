-- Programacao de Recursos: segundo motorista (turno da tarde) para onibus/vans.
-- Colunas opcionais: o operador existente continua sendo o motorista principal (manha).
-- AlterTable
ALTER TABLE "programacao_recursos" ADD COLUMN     "operador_tarde_matricula" VARCHAR(50),
ADD COLUMN     "operador_tarde_nome" VARCHAR(255);

-- AlterTable
ALTER TABLE "programacao_recursos_terceiros" ADD COLUMN     "operador_tarde_matricula" VARCHAR(50),
ADD COLUMN     "operador_tarde_nome" VARCHAR(255);
