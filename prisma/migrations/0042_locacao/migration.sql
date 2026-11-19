-- ============================================================================
-- 0042 - Locacao (Serra Norte / Serra Leste) dentro do contrato.
-- O que o sistema antigo chamava de "contrato" ("Eletromecanica", "Serra Leste")
-- era a LOCACAO do contrato 251. A migration 0039 uniu tudo em 251 mas guardou os
-- valores antigos em contrato_legado_backup; aqui eles voltam como locacao:
--   Eletromecanica -> Serra Norte ; Serra Leste -> Serra Leste.
-- Valores antigos sem correspondencia (ex.: "CT-251") ficam sem locacao e podem ser
-- ajustados na tela de Frota. O backup NAO e alterado.
-- ============================================================================

ALTER TABLE "mob_desmob" ADD COLUMN "locacao" VARCHAR(60);
ALTER TABLE "abastecimentos" ADD COLUMN "locacao" VARCHAR(60);
ALTER TABLE "parametros_preventiva" ADD COLUMN "locacao" VARCHAR(60);

-- Traduz o texto antigo para a locacao (ignora acento e caixa). NULL = sem correspondencia.
CREATE FUNCTION "locacao_do_contrato_antigo"(valor text) RETURNS text AS $$
  SELECT CASE
    WHEN valor IS NULL THEN NULL
    WHEN upper(translate(valor, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) LIKE '%ELETROMEC%' THEN 'Serra Norte'
    WHEN upper(translate(valor, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) LIKE '%NORTE%' THEN 'Serra Norte'
    WHEN upper(translate(valor, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) LIKE '%LESTE%' THEN 'Serra Leste'
    ELSE NULL
  END
$$ LANGUAGE sql IMMUTABLE;

-- Veiculos: a locacao de cada TAG volta do backup.
UPDATE "mob_desmob" m
   SET "locacao" = "locacao_do_contrato_antigo"(b."contrato_antigo")
  FROM "contrato_legado_backup" b
 WHERE b."tabela" = 'mob_desmob' AND b."chave" = m."tag"
   AND "locacao_do_contrato_antigo"(b."contrato_antigo") IS NOT NULL;

-- Abastecimentos: a locacao gravada na linha; sem ela, a do veiculo.
UPDATE "abastecimentos" a
   SET "locacao" = "locacao_do_contrato_antigo"(b."contrato_antigo")
  FROM "contrato_legado_backup" b
 WHERE b."tabela" = 'abastecimentos' AND b."chave" = a."id"::text
   AND "locacao_do_contrato_antigo"(b."contrato_antigo") IS NOT NULL;
UPDATE "abastecimentos" a
   SET "locacao" = m."locacao"
  FROM "mob_desmob" m
 WHERE a."locacao" IS NULL AND a."tag" = m."tag" AND m."locacao" IS NOT NULL;

-- Regras de preventiva: uma por (categoria, contrato, locacao).
-- (conforme a migration que o criou, e restricao ou indice unico)
ALTER TABLE "parametros_preventiva" DROP CONSTRAINT IF EXISTS "parametros_preventiva_categoria_contrato_key";
DROP INDEX IF EXISTS "parametros_preventiva_categoria_contrato_key";

-- As que sobreviveram a unificacao da 0039 recuperam a propria locacao...
UPDATE "parametros_preventiva" p
   SET "locacao" = "locacao_do_contrato_antigo"(b."contrato_antigo")
  FROM "contrato_legado_backup" b
 WHERE b."tabela" = 'parametros_preventiva' AND b."chave" = p."id"::text
   AND p."contrato" IS NOT NULL
   AND "locacao_do_contrato_antigo"(b."contrato_antigo") IS NOT NULL;

-- ...e as que a 0039 removeu (guardadas em `dados`) voltam quando tinham locacao.
INSERT INTO "parametros_preventiva" ("id", "categoria", "km_limite_preventiva", "contrato", "locacao", "created_at", "updated_at")
SELECT (r.dados->>'id')::uuid, r.dados->>'categoria', (r.dados->>'km_limite_preventiva')::int, '251', r.locacao,
       COALESCE((r.dados->>'created_at')::timestamp, now()), COALESCE((r.dados->>'updated_at')::timestamp, now())
  FROM (
    SELECT DISTINCT ON (b.dados->>'categoria', "locacao_do_contrato_antigo"(b."contrato_antigo"))
           b.dados, "locacao_do_contrato_antigo"(b."contrato_antigo") AS locacao
      FROM "contrato_legado_backup" b
     WHERE b."tabela" = 'parametros_preventiva' AND b.dados IS NOT NULL
       AND "locacao_do_contrato_antigo"(b."contrato_antigo") IS NOT NULL
     ORDER BY b.dados->>'categoria', "locacao_do_contrato_antigo"(b."contrato_antigo"), b.dados->>'updated_at' DESC
  ) r
 WHERE NOT EXISTS (SELECT 1 FROM "parametros_preventiva" p WHERE p."id" = (r.dados->>'id')::uuid)
   AND NOT EXISTS (SELECT 1 FROM "parametros_preventiva" p
                    WHERE p."categoria" = r.dados->>'categoria' AND p."contrato" = '251' AND p."locacao" = r.locacao);

CREATE UNIQUE INDEX "parametros_preventiva_categoria_contrato_locacao_key" ON "parametros_preventiva"("categoria", "contrato", "locacao");
CREATE INDEX "mob_desmob_contrato_locacao_idx" ON "mob_desmob"("contrato", "locacao");

DROP FUNCTION "locacao_do_contrato_antigo"(text);
