CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS mob_desmob (
    tag VARCHAR(50) PRIMARY KEY,
    placa VARCHAR(20) UNIQUE NOT NULL,
    foto_veiculo TEXT,
    status VARCHAR(50) NOT NULL,
    data_mob DATE DEFAULT CURRENT_DATE,
    data_desmob DATE,
    modelo VARCHAR(100),
    contrato VARCHAR(100),
    created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mob_desmob_placa ON mob_desmob(placa);
CREATE INDEX IF NOT EXISTS idx_mob_desmob_status ON mob_desmob(status);

CREATE TABLE IF NOT EXISTS documentacao_veiculos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag VARCHAR(50) NOT NULL REFERENCES mob_desmob(tag) ON DELETE CASCADE,
    documento VARCHAR(100) NOT NULL,
    validade DATE NOT NULL,
    anexo_url TEXT,
    created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documentacao_tag ON documentacao_veiculos(tag);
CREATE INDEX IF NOT EXISTS idx_documentacao_validade ON documentacao_veiculos(validade);
CREATE INDEX IF NOT EXISTS idx_documentacao_tag_validade ON documentacao_veiculos(tag, validade);

CREATE TABLE IF NOT EXISTS partes_diarias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag VARCHAR(50) NOT NULL REFERENCES mob_desmob(tag) ON DELETE RESTRICT,
    funcionario VARCHAR(255),
    funcao VARCHAR(100),
    obra VARCHAR(100) NOT NULL,
    obra_programada VARCHAR(100),
    data DATE DEFAULT CURRENT_DATE,
    id_relatorio VARCHAR(100),
    status VARCHAR(50) NOT NULL,
    lideranca VARCHAR(100),
    operador VARCHAR(100),
    aderencia BOOLEAN,
    eficiencia NUMERIC(5,2),
    status_assinatura VARCHAR(50) DEFAULT 'PENDENTE',
    assinatura_dados JSONB,
    created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partes_tag ON partes_diarias(tag);
CREATE INDEX IF NOT EXISTS idx_partes_data ON partes_diarias(data);
CREATE INDEX IF NOT EXISTS idx_partes_status_assinatura ON partes_diarias(status_assinatura);
CREATE INDEX IF NOT EXISTS idx_partes_tag_data ON partes_diarias(tag, data);

CREATE OR REPLACE VIEW vw_farol_documentos AS
SELECT
    dv.id,
    dv.tag,
    md.placa,
    md.modelo,
    dv.documento,
    dv.validade,
    dv.anexo_url,
    dv.created_at,
    CASE
        WHEN dv.validade < CURRENT_DATE THEN 'VERMELHO'
        WHEN dv.validade < CURRENT_DATE + INTERVAL '15 days' THEN 'AMARELO'
        ELSE 'VERDE'
    END AS farol_status,
    (dv.validade - CURRENT_DATE) AS dias_para_vencer
FROM documentacao_veiculos dv
INNER JOIN mob_desmob md ON md.tag = dv.tag
ORDER BY dv.validade ASC;
