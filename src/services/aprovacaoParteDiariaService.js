// ============================================================================
// Regras do fluxo de aprovacao da Parte Diaria (RDO).
//  - "Finalizado pelo Operador" so com KM Inicial e KM Final validas (> 0).
//  - Aprovacao em lote pelo Transporte/Master: assina a etapa TRANSPORTE em
//    varias partes "Finalizado pelo Operador" de uma vez.
// ============================================================================
import { parseKm } from './manutencaoService.js';

export const STATUS_FINALIZADO_OPERADOR = 'Finalizado pelo Operador';
export const STATUS_EM_PREENCHIMENTO = 'Em Preenchimento';
export const STATUS_REVISADO_TRANSPORTE = 'Revisado pelo Transporte';
export const STATUS_APROVADO = 'Aprovado';
export const LOTE_MAX = 200;

export const MSG_KM_OBRIGATORIA = 'Para finalizar a Parte Diária, preencha a KM Inicial e a KM Final (números maiores que zero).';

/**
 * Mensagem do que falta na KM para finalizar, ou null quando está ok.
 * Manutenção Preventiva é lançada de forma retroativa e o formulário não pede
 * KM Inicial: nela basta a KM Final (> 0), como na trava do odômetro.
 */
export function pendenciaKmFinalizacao(kmInicial, kmFinal, statusOperacional = null) {
  const ini = parseKm(kmInicial);
  const fim = parseKm(kmFinal);
  const faltando = [];
  if (statusOperacional !== 'Manutenção Preventiva' && (ini === null || !(ini > 0))) faltando.push('KM Inicial');
  if (fim === null || !(fim > 0)) faltando.push('KM Final');
  if (!faltando.length) return null;
  return `${MSG_KM_OBRIGATORIA} Falta: ${faltando.join(' e ')}.`;
}

export function kmValidaParaFinalizar(kmInicial, kmFinal, statusOperacional = null) {
  return pendenciaKmFinalizacao(kmInicial, kmFinal, statusOperacional) === null;
}

/** Quem aprova em lote: setor Transporte ou nível Master (sempre administrador). */
export function podeAprovarLoteTransporte(usuario) {
  if (!usuario || usuario.tipo !== 'ADMINISTRADOR') return false;
  return usuario.nivel === 'MASTER' || usuario.setor === 'TRANSPORTE';
}

/** IDs únicos e no formato UUID; lança 400 para entrada inválida. */
export function normalizarIdsLote(ids) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('Selecione ao menos uma Parte Diária.');
    e.statusCode = 400;
    throw e;
  }
  const unicos = [...new Set(ids.map((v) => String(v || '').trim()))].filter(Boolean);
  if (unicos.length > LOTE_MAX) {
    const e = new Error(`Aprove no máximo ${LOTE_MAX} Partes Diárias por vez.`);
    e.statusCode = 400;
    throw e;
  }
  if (unicos.some((v) => !UUID.test(v))) {
    const e = new Error('Há identificadores inválidos na seleção.');
    e.statusCode = 400;
    throw e;
  }
  return unicos;
}

/**
 * Separa a seleção em aptas (status Finalizado pelo Operador, KM válida e sem
 * assinatura do Transporte) e recusadas, com o motivo de cada recusa.
 * `partes` precisa trazer km_*, status_operacional, status_aprovacao, assinaturas{etapa} e veiculo{modelo}.
 */
export function classificarLote(ids, partes) {
  const porId = new Map(partes.map((p) => [p.id, p]));
  const aptas = [];
  const recusadas = [];
  for (const id of ids) {
    const p = porId.get(id);
    if (!p) { recusadas.push({ id, motivo: 'Não encontrada ou excluída.' }); continue; }
    const etapas = new Set((p.assinaturas || []).map((a) => String(a.etapa || '').toUpperCase()));
    if (p.status_aprovacao !== STATUS_FINALIZADO_OPERADOR || !etapas.has('OPERADOR')) {
      recusadas.push({ id, tag: p.tag, motivo: `Status atual "${p.status_aprovacao}" (precisa estar "${STATUS_FINALIZADO_OPERADOR}").` });
      continue;
    }
    if (etapas.has('TRANSPORTE')) { recusadas.push({ id, tag: p.tag, motivo: 'Já assinada pelo Transporte.' }); continue; }
    const km = pendenciaKmFinalizacao(p.km_inicial, p.km_final, p.status_operacional);
    if (km) { recusadas.push({ id, tag: p.tag, motivo: 'KM Inicial/Final incompleta.' }); continue; }
    aptas.push(p);
  }
  return { aptas, recusadas };
}
