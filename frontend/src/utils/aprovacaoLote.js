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

// ---------------------------------------------------------------------------
// Etapa final: Gestão / Planejamento (ou ADM Master).
// ---------------------------------------------------------------------------

export const STATUS_REVISADO_TRANSPORTE = 'Revisado pelo Transporte';
export const MSG_DESVIO_LOTE = 'Item com desvio de programação — abra para revisar a justificativa e aprovar individualmente';

/** Gestão (Técnico de Planejamento) ou ADM Master. */
export function podeAprovarLotePlanejamento(usuario) {
  if (!usuario || usuario.tipo !== 'ADMINISTRADOR') return false;
  return usuario.nivel === 'MASTER' || ['GESTAO', 'PLANEJADOR'].includes(usuario.setor);
}

/** Desvio de programação (servidor envia o campo; RDO antigo cai na aderência). */
export function houveDesvio(parte) {
  if (typeof parte?.houve_desvio_programacao === 'boolean') return parte.houve_desvio_programacao;
  return parte?.aderencia === false;
}

const statusDe = (parte) => parte?.status_aprovacao || parte?.status;

/** "Revisado pelo Transporte", com Transporte assinado, sem Planejamento e sem desvio. */
export function aptaParaLotePlanejamento(parte) {
  if (!parte || statusDe(parte) !== STATUS_REVISADO_TRANSPORTE || houveDesvio(parte)) return false;
  if (parte.assinaturas) {
    const assinadas = etapas(parte);
    if (!assinadas.has('TRANSPORTE') || assinadas.has('PLANEJADOR')) return false;
  }
  return true;
}

/** Em qual lote o item pode entrar para este usuário: 'transporte' | 'planejamento' | null. */
export function loteDaParte(parte, usuario) {
  if (podeAprovarLoteTransporte(usuario) && aptaParaLoteTransporte(parte)) return 'transporte';
  if (podeAprovarLotePlanejamento(usuario) && aptaParaLotePlanejamento(parte)) return 'planejamento';
  return null;
}

/** Tooltip do checkbox desabilitado (por que não entra em lote). */
export function motivoForaDoLote(parte, usuario) {
  const status = statusDe(parte);
  if (podeAprovarLotePlanejamento(usuario) && status === STATUS_REVISADO_TRANSPORTE && houveDesvio(parte)) {
    return MSG_DESVIO_LOTE;
  }
  if (status === STATUS_FINALIZADO_OPERADOR && podeAprovarLoteTransporte(usuario)) {
    return 'KM Inicial/Final incompleta: o operador precisa completar a KM';
  }
  if (status === 'Aprovado') return 'Parte Diária já aprovada';
  const etapasDoUsuario = [
    podeAprovarLoteTransporte(usuario) && `"${STATUS_FINALIZADO_OPERADOR}"`,
    podeAprovarLotePlanejamento(usuario) && `"${STATUS_REVISADO_TRANSPORTE}" sem desvio`,
  ].filter(Boolean).join(' ou ');
  return `Só entram na aprovação em lote as Partes Diárias ${etapasDoUsuario}`;
}

// ---------------------------------------------------------------------------
// Filtros rápidos executivos da listagem.
// ---------------------------------------------------------------------------

export const FILTROS_RAPIDOS = [
  { chave: 'todas', rotulo: 'Todas' },
  { chave: 'aguardando-planejamento', rotulo: 'Aguardando Planejamento' },
  { chave: 'com-desvio', rotulo: '⚠️ Com Desvio de Programação' },
];

export function passaFiltroRapido(parte, chave) {
  if (chave === 'aguardando-planejamento') return statusDe(parte) === STATUS_REVISADO_TRANSPORTE && !houveDesvio(parte);
  if (chave === 'com-desvio') return houveDesvio(parte);
  return true;
}

/** Contadores das pílulas; `desvioPendentes` = com desvio ainda não aprovadas. */
export function contarFiltrosRapidos(partes) {
  const contagem = { todas: 0, 'aguardando-planejamento': 0, 'com-desvio': 0, desvioPendentes: 0 };
  for (const p of partes || []) {
    contagem.todas += 1;
    if (passaFiltroRapido(p, 'aguardando-planejamento')) contagem['aguardando-planejamento'] += 1;
    if (houveDesvio(p)) {
      contagem['com-desvio'] += 1;
      if (statusDe(p) !== 'Aprovado') contagem.desvioPendentes += 1;
    }
  }
  return contagem;
}

/** Comparativo Programado → Realizado de um item com desvio. */
export function comparativoDesvio(parte) {
  const statusOp = String(parte?.status_operacional || parte?.status || '').trim();
  const realizadoObra = parte?.obra_ref?.nome || parte?.obra || null;
  return {
    programado: parte?.obra_programada_ref?.nome || parte?.obra_programada || '—',
    realizado: statusOp && statusOp !== 'Operação'
      ? `${statusOp}${realizadoObra ? ` (${realizadoObra})` : ''}`
      : (realizadoObra || 'Sem obra informada'),
    categoria: parte?.categoria_desvio?.nome || null,
    justificativa: String(parte?.justificativa_desvio || '').trim() || null,
  };
}
