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

// ---------------------------------------------------------------------------
// Etapa final: Gestão / Planejamento (ou ADM Master).
// ---------------------------------------------------------------------------

export const MSG_DESVIO_LOTE = 'Item com desvio de programação — abra para revisar a justificativa e aprovar individualmente.';

/** Gestão (Técnico de Planejamento) ou ADM Master. */
export function podeAprovarLotePlanejamento(usuario) {
  if (!usuario || usuario.tipo !== 'ADMINISTRADOR') return false;
  return usuario.nivel === 'MASTER' || ['GESTAO', 'PLANEJADOR'].includes(usuario.setor);
}

/** Desvio de programação = RDO programado que não seguiu a programação. */
export function houveDesvioProgramacao(parte) {
  return parte?.aderencia === false;
}

/**
 * Aptas ao lote do Planejamento: "Revisado pelo Transporte", com assinatura
 * do Transporte, ainda sem a do Planejamento e SEM desvio de programação
 * (desvio exige conferência individual da justificativa).
 */
export function classificarLotePlanejamento(ids, partes) {
  const porId = new Map(partes.map((p) => [p.id, p]));
  const aptas = [];
  const recusadas = [];
  for (const id of ids) {
    const p = porId.get(id);
    if (!p) { recusadas.push({ id, motivo: 'Não encontrada ou excluída.' }); continue; }
    const etapas = new Set((p.assinaturas || []).map((a) => String(a.etapa || '').toUpperCase()));
    if (p.status_aprovacao !== STATUS_REVISADO_TRANSPORTE || !etapas.has('TRANSPORTE')) {
      recusadas.push({ id, tag: p.tag, motivo: `Status atual "${p.status_aprovacao}" (precisa estar "${STATUS_REVISADO_TRANSPORTE}").` });
      continue;
    }
    if (etapas.has('PLANEJADOR')) { recusadas.push({ id, tag: p.tag, motivo: 'Já assinada pelo Planejamento.' }); continue; }
    if (houveDesvioProgramacao(p)) {
      recusadas.push({ id, tag: p.tag, motivo: MSG_DESVIO_LOTE, desvio: true });
      continue;
    }
    aptas.push(p);
  }
  return { aptas, recusadas };
}

// ---------------------------------------------------------------------------
// Execução comum dos lotes (Transporte e Planejamento).
// ---------------------------------------------------------------------------

const SELECT_LOTE = {
  id: true, tag: true, status_aprovacao: true, status_operacional: true,
  km_inicial: true, km_final: true, aderencia: true,
  assinaturas: { select: { etapa: true } },
  veiculo: { select: { modelo: true } },
};

function erroHttp(status, message, extra = {}) {
  const e = new Error(message);
  e.statusCode = status;
  Object.assign(e, extra);
  return e;
}

/**
 * Assina `etapa` nas partes aptas e atualiza o status via updateMany.
 * @param classificar  (ids, partes) => { aptas, recusadas }
 * @param destino      (parte) => { status_aprovacao, status_relatorio, status_assinatura }
 * @param statusOrigem status exigido no updateMany (proteção contra corrida)
 * @returns { aprovadas: [{id, tag, status_aprovacao}], recusadas }
 */
export async function executarLoteAprovacao(client, {
  ids, atuante, imagem, etapa, classificar, destino, statusOrigem, acaoLog, mensagemVazio,
}) {
  const unicos = normalizarIdsLote(ids);
  if (!imagem) {
    throw erroHttp(400, 'Cadastre sua assinatura no Perfil ou desenhe-a para aprovar em lote.');
  }
  const partes = await client.parteDiaria.findMany({
    where: { id: { in: unicos }, deletado_em: null, veiculo: { deletado_em: null } },
    select: SELECT_LOTE,
  });
  const { aptas, recusadas } = classificar(unicos, partes);
  if (!aptas.length) throw erroHttp(409, mensagemVazio, { aprovadas: [], recusadas });

  // Agrupa por status de destino para um updateMany por grupo.
  const grupos = new Map();
  const aprovadas = aptas.map((p) => {
    const dados = destino(p);
    const chave = JSON.stringify(dados);
    if (!grupos.has(chave)) grupos.set(chave, { dados, ids: [] });
    grupos.get(chave).ids.push(p.id);
    return { id: p.id, tag: p.tag, status_aprovacao: dados.status_aprovacao };
  });
  const agora = new Date();
  const autor = atuante.nome;

  await client.$transaction(async (tx) => {
    await tx.parteDiariaAssinatura.createMany({
      data: aptas.map((p) => ({
        parte_id: p.id, etapa, nome: atuante.nome, matricula: atuante.matricula,
        assinatura_dado: imagem, assinado_em: agora,
      })),
      skipDuplicates: true,
    });
    for (const { dados, ids: grupo } of grupos.values()) {
      await tx.parteDiaria.updateMany({
        where: { id: { in: grupo }, status_aprovacao: statusOrigem, deletado_em: null },
        data: { ...dados, atualizado_por: autor },
      });
    }
    await tx.parteDiariaLog.createMany({
      data: aprovadas.map((a) => ({
        parte_id: a.id, acao: acaoLog, autor,
        detalhes: { etapa, lote: aptas.length, matricula: atuante.matricula, status_aprovacao: a.status_aprovacao },
      })),
    });
  }, { timeout: 30000, maxWait: 15000 });

  return { aprovadas, recusadas };
}
