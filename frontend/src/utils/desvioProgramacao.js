// ============================================================================
// Desvio de Programação na Parte Diária (espelha a regra do servidor em
// src/services/aderenciaProgramacaoService.js).
//   - sem programação no dia      -> sem desvio (fora do indicador)
//   - status do dia ≠ Operação    -> desvio (não trabalhou na obra programada)
//   - obra diferente / sem obra   -> desvio
// ============================================================================

export const JUSTIFICATIVA_MAX = 2000;

function normalizar(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * @param programacao resposta de GET /api/partes-diarias/obra-programada (data)
 * @returns {{ programada: boolean, obraProgramada: object|null, desvio: boolean }}
 */
export function avaliarDesvio(programacao, { obraId, obraTexto, statusOperacional = 'Operação' } = {}) {
  const obraProgramada = programacao?.programada && programacao.obra ? programacao.obra : null;
  if (!obraProgramada) return { programada: false, obraProgramada: null, desvio: false };
  let aderente = false;
  if (statusOperacional && statusOperacional !== 'Operação') aderente = false;
  else if (obraId) aderente = obraId === obraProgramada.id;
  else if (normalizar(obraTexto)) aderente = normalizar(obraTexto) === normalizar(obraProgramada.nome);
  return { programada: true, obraProgramada, desvio: !aderente };
}

/**
 * Mensagem do que falta para concluir com desvio, ou null quando está ok.
 * Só a categoria é obrigatória; a justificativa é opcional.
 */
export function pendenciaDesvio({ desvio, categoriaId }) {
  if (!desvio || categoriaId) return null;
  return 'Desvio de Programação: selecione a categoria do desvio';
}

/** Campos de desvio para o payload (limpos quando não há desvio). */
export function camposDesvioPayload({ desvio, categoriaId, justificativa }) {
  if (!desvio) return { categoria_desvio_id: null, justificativa_desvio: null };
  const texto = String(justificativa || '').trim();
  return {
    categoria_desvio_id: categoriaId || null,
    justificativa_desvio: texto ? texto.slice(0, JUSTIFICATIVA_MAX) : null,
  };
}
