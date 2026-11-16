// ============================================================================
// Regras do fluxo de aprovação da Parte Diária no cliente (espelho de
// src/services/aprovacaoParteDiariaService.js). O servidor revalida tudo.
// ============================================================================

export const STATUS_FINALIZADO_OPERADOR = 'Finalizado pelo Operador';

function numeroKm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que falta na KM para finalizar como operador, ou null.
 * Preventiva (retroativa, sem KM Inicial no formulário) exige só a KM Final.
 */
export function pendenciaKmFinalizacao(kmInicial, kmFinal, statusOperacional = null) {
  const ini = numeroKm(kmInicial);
  const fim = numeroKm(kmFinal);
  const faltando = [];
  if (statusOperacional !== 'Manutenção Preventiva' && !(ini > 0)) faltando.push('KM Inicial');
  if (!(fim > 0)) faltando.push('KM Final');
  if (!faltando.length) return null;
  return `Para finalizar a Parte Diária, preencha a ${faltando.join(' e a ')} (número maior que zero).`;
}

/** Transporte (setor) ou ADM Master aprovam em lote. */
export function podeAprovarLoteTransporte(usuario) {
  if (!usuario || usuario.tipo !== 'ADMINISTRADOR') return false;
  return usuario.nivel === 'MASTER' || usuario.setor === 'TRANSPORTE';
}

function etapas(parte) {
  return new Set((parte?.assinaturas || []).map((a) => String(a?.etapa || '').toUpperCase()));
}

/** Parte pode entrar na aprovação em lote do Transporte? */
export function aptaParaLoteTransporte(parte) {
  if (!parte) return false;
  const status = parte.status_aprovacao || parte.status;
  if (status !== STATUS_FINALIZADO_OPERADOR) return false;
  const assinadas = etapas(parte);
  // A listagem pode não trazer as assinaturas: o status já indica a etapa.
  if (parte.assinaturas && assinadas.has('TRANSPORTE')) return false;
  return pendenciaKmFinalizacao(parte.km_inicial, parte.km_final, parte.status_operacional) === null;
}

/** Estado do checkbox mestre: 'todos' | 'alguns' | 'nenhum'. */
export function estadoSelecaoMestre(aptas, selecionados) {
  const ids = aptas.map((p) => p.id);
  const marcados = ids.filter((id) => selecionados.has(id)).length;
  if (!ids.length || marcados === 0) return 'nenhum';
  return marcados === ids.length ? 'todos' : 'alguns';
}

/** Alterna o mestre: marca todas as aptas visíveis ou desmarca-as. */
export function alternarSelecaoMestre(aptas, selecionados) {
  const proximo = new Set(selecionados);
  if (estadoSelecaoMestre(aptas, selecionados) === 'todos') aptas.forEach((p) => proximo.delete(p.id));
  else aptas.forEach((p) => proximo.add(p.id));
  return proximo;
}
