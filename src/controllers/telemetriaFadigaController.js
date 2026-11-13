// ============================================================================
// src/controllers/telemetriaFadigaController.js — Análise de Fadiga Detectada e
// Planos de Ação (PGS-007245 Rev. 03, Anexo I — "Eventos de Fadiga").
//
//   GET   /api/telemetria/fadiga?horas=&inicio=&fim=&busca=&classificacao=
//         Ocorrências de fadiga detectada com farol (VEICULO_PARADO | EM_ANALISE |
//         CONFIRMADA | DESCARTADA), parada obrigatória, recorrência no mês, medida
//         recomendada, plano de ação vinculado, coordenadas para o mapa e KPIs.
//   PATCH /api/telemetria/fadiga/validacao  { ids, decisao: CONFIRMADA|DESCARTADA|AUTOMATICA, motivo? }
//   GET   /api/telemetria/motoristas/historico?motorista=
//         Todos os eventos do condutor, ocorrências de fadiga, resumo mensal e planos.
//   GET   /api/telemetria/matriz-fadiga  -> matriz do Anexo I e critérios da análise
//   GET/POST /api/telemetria/planos ; PATCH/DELETE /api/telemetria/planos/:id
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { registrarLogAtividade } from '../services/auditService.js';
import { comRetryConexao } from '../utils/retryBanco.js';
import { erroHttp } from '../services/telemetriaPlanilhaService.js';
import { lerSemanasOuErro, montarFiltro } from './telemetriaController.js';
import {
  CLASSIFICACAO_FADIGA,
  EVENTOS,
  JANELA_FADIGA_MIN,
  LINHAS_MATRIZ_FADIGA,
  MATRIZ_FADIGA,
  NOTAS_MATRIZ_FADIGA,
  PRAZO_TRATATIVA_DIAS,
  VELOCIDADE_MINIMA_FADIGA_KMH,
  agruparOcorrenciasFadiga,
  medidaFadiga,
  medidaRecomendada,
} from '../utils/classificacaoTelemetria.js';
import { analisarOcorrenciasVelocidade, resumirOcorrenciaVelocidade } from './telemetriaVelocidadeController.js';

/** Linhas da matriz de velocidade aceitas nos planos (VELOCIDADE_ + severidade do Anexo I). */
const LINHAS_MATRIZ_VELOCIDADE = ['VELOCIDADE_MODERADO', 'VELOCIDADE_GRAVE', 'VELOCIDADE_CRITICO'];

const MODULO_AUDITORIA = 'TELEMETRIA';
const FUSO_MS = -3 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_PLANO = ['ABERTO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'];
const CLASSIFICACOES = Object.values(CLASSIFICACAO_FADIGA);

const comRetry = (fn, rotulo) => comRetryConexao(fn, 3, 700, `telemetria-fadiga:${rotulo}`);

const CAMPOS_DETECCAO = {
  id: true, tag_placa: true, tag: true, motorista: true, data_hora: true, valor: true, limite: true,
  localizacao: true, latitude: true, longitude: true, link_mapa: true, cerca: true,
  parou_em_15_min: true, validacao_fadiga: true, validacao_motivo: true, validado_por: true, validado_em: true,
  plano_acao_id: true, status_tratativa: true,
};

function mesLocal(data) {
  return new Date(new Date(data).getTime() + FUSO_MS).toISOString().slice(0, 7);
}

/** Início do mês (-03:00) de uma data, para contar a recorrência do mês inteiro. */
function inicioDoMesDe(data) {
  const ref = mesLocal(data);
  const [ano, mes] = ref.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, 1) - FUSO_MS);
}

function texto(valor, max) {
  if (valor === undefined || valor === null) return null;
  const t = String(valor).trim();
  return t ? t.slice(0, max) : null;
}

function idsValidos(ids, campo = 'ids') {
  if (!Array.isArray(ids) || ids.length === 0) throw erroHttp(400, `Envie "${campo}" com ao menos um evento.`);
  if (ids.length > 500) throw erroHttp(400, `No maximo 500 itens em "${campo}".`);
  const lista = [...new Set(ids.map((id) => String(id).toLowerCase()))];
  if (lista.some((id) => !UUID.test(id))) throw erroHttp(400, `Identificador invalido em "${campo}".`);
  return lista;
}

/**
 * Classifica as ocorrências e calcula, para cada condutor, a ordem no mês das ocorrências
 * de fadiga CONFIRMADA e das paradas obrigatórias não cumpridas (linhas 1 e 3 da matriz).
 */
export function analisarOcorrencias(deteccoes) {
  const ocorrencias = agruparOcorrenciasFadiga(deteccoes);
  const contagem = new Map();
  for (const o of ocorrencias) {
    o.sem_parada = o.deteccoes.some((d) => d.parou_em_15_min === false);
    const d0 = o.deteccoes[0];
    o.tag = o.deteccoes.find((d) => d.tag)?.tag ?? null;
    o.latitude = d0.latitude ?? null;
    o.longitude = d0.longitude ?? null;
    o.localizacao = d0.localizacao ?? null;
    o.link_mapa = d0.link_mapa ?? null;
    o.cerca = d0.cerca ?? null;
    o.plano_acao_id = o.deteccoes.map((d) => d.plano_acao_id).find(Boolean) || null;
    o.ids = o.deteccoes.map((d) => d.id);
    o.ocorrencia_no_mes = null;
    o.sem_parada_no_mes = null;
    o.medidas = null;
    if (o.classificacao !== CLASSIFICACAO_FADIGA.CONFIRMADA || !o.motorista) continue;
    const chave = `${o.motorista}|${mesLocal(o.inicio)}`;
    const c = contagem.get(chave) || { fadiga: 0, semParada: 0 };
    c.fadiga += 1;
    if (o.sem_parada) c.semParada += 1;
    contagem.set(chave, c);
    o.ocorrencia_no_mes = c.fadiga;
    o.sem_parada_no_mes = o.sem_parada ? c.semParada : null;
    o.medidas = {
      elegivel: medidaFadiga(LINHAS_MATRIZ_FADIGA.FADIGA_VERDADEIRA, c.fadiga, true),
      nao_elegivel: medidaFadiga(LINHAS_MATRIZ_FADIGA.FADIGA_VERDADEIRA, c.fadiga, false),
      sem_parada: o.sem_parada ? medidaFadiga(LINHAS_MATRIZ_FADIGA.SEM_PARADA, c.semParada) : null,
    };
  }
  return ocorrencias;
}

async function planosPorId(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const planos = await comRetry(() => prisma.planoAcaoTelemetria.findMany({
    where: { id: { in: unicos } },
    select: { id: true, status: true, linha_matriz: true, prazo: true, responsavel: true },
  }), 'planos-vinculados');
  return new Map(planos.map((p) => [p.id, p]));
}

function semDeteccoes(o) {
  const { deteccoes, ...resto } = o;
  return { ...resto, deteccoes: deteccoes.map((d) => ({ id: d.id, data_hora: d.data_hora, valor: d.valor, parou_em_15_min: d.parou_em_15_min, validacao_fadiga: d.validacao_fadiga })) };
}

// ============================================================================
// 1. ANÁLISE DE FADIGA DETECTADA
// ============================================================================
export const analiseFadiga = asyncHandler(async (req, res) => {
  const agora = new Date();
  const { classificacao, evento, severidade, semanas, ...filtros } = req.query;
  const where = { ...montarFiltro(filtros, agora), evento: EVENTOS.FADIGA };
  // A recorrência conta o mês inteiro: busca desde o início do mês da data inicial.
  const intervalo = where.data_hora;
  if (intervalo?.gte) where.data_hora = { ...intervalo, gte: inicioDoMesDe(intervalo.gte) };
  // Semanas selecionadas: lê desde o início do mês da primeira (a recorrência é mensal) e
  // depois mostra só as ocorrências que começam dentro das semanas escolhidas.
  const selecao = lerSemanasOuErro(semanas);
  if (selecao) where.data_hora = { gte: inicioDoMesDe(selecao.inicio), lt: selecao.fim };

  const deteccoes = await comRetry(() => prisma.eventoTelemetria.findMany({
    where,
    select: CAMPOS_DETECCAO,
    orderBy: [{ data_hora: 'asc' }, { id: 'asc' }],
    take: 5000,
  }), 'fadiga');

  let ocorrencias = analisarOcorrencias(deteccoes);
  if (intervalo?.gte) ocorrencias = ocorrencias.filter((o) => new Date(o.fim) >= intervalo.gte);
  if (selecao) ocorrencias = ocorrencias.filter((o) => selecao.contem(o.inicio));
  const filtroClassificacao = String(classificacao || '').toUpperCase().split(',').filter(Boolean);
  if (filtroClassificacao.some((c) => !CLASSIFICACOES.includes(c))) {
    throw erroHttp(400, `Classificacao invalida. Aceitas: ${CLASSIFICACOES.join(', ')}.`);
  }
  const porClassificacao = Object.fromEntries(CLASSIFICACOES.map((c) => [c, 0]));
  ocorrencias.forEach((o) => { porClassificacao[o.classificacao] += 1; });
  const confirmadas = ocorrencias.filter((o) => o.classificacao === CLASSIFICACAO_FADIGA.CONFIRMADA);
  const visiveis = filtroClassificacao.length ? ocorrencias.filter((o) => filtroClassificacao.includes(o.classificacao)) : ocorrencias;

  const planos = await planosPorId(visiveis.map((o) => o.plano_acao_id));
  const lista = visiveis
    .map((o) => ({ ...semDeteccoes(o), plano_acao: o.plano_acao_id ? planos.get(o.plano_acao_id) || null : null }))
    .sort((a, b) => new Date(b.inicio) - new Date(a.inicio));

  // Ranking de condutores com fadiga confirmada (e quantas sem parada obrigatória).
  const ranking = new Map();
  for (const o of confirmadas) {
    const chave = o.motorista || o.tag_placa;
    const r = ranking.get(chave) || { motorista: o.motorista, tag: o.tag, placa: o.tag_placa, confirmadas: 0, sem_parada: 0, sem_plano: 0 };
    r.confirmadas += 1;
    if (o.sem_parada) r.sem_parada += 1;
    if (!o.plano_acao_id) r.sem_plano += 1;
    ranking.set(chave, r);
  }

  return res.status(200).json({
    criterios: {
      velocidade_minima_kmh: VELOCIDADE_MINIMA_FADIGA_KMH,
      janela_min: JANELA_FADIGA_MIN,
    },
    kpis: {
      deteccoes: ocorrencias.reduce((soma, o) => soma + o.deteccoes.length, 0),
      ocorrencias: ocorrencias.length,
      por_classificacao: porClassificacao,
      sem_parada_obrigatoria: confirmadas.filter((o) => o.sem_parada).length,
      condutores_com_fadiga_confirmada: ranking.size,
      confirmadas_sem_plano: confirmadas.filter((o) => !o.plano_acao_id).length,
    },
    ocorrencias: lista,
    ranking_condutores: [...ranking.values()].sort((a, b) => b.confirmadas - a.confirmadas || b.sem_parada - a.sem_parada).slice(0, 10),
  });
});

/** Validação da Central sobre as detecções de uma ocorrência (prevalece sobre o farol automático). */
export const validarFadiga = asyncHandler(async (req, res) => {
  const ids = idsValidos(req.body?.ids);
  const decisao = String(req.body?.decisao || '').toUpperCase();
  if (!['CONFIRMADA', 'DESCARTADA', 'AUTOMATICA'].includes(decisao)) {
    throw erroHttp(400, 'Informe "decisao": CONFIRMADA, DESCARTADA ou AUTOMATICA (volta ao farol automatico).');
  }
  const motivo = texto(req.body?.motivo, 2000);
  if (decisao === 'DESCARTADA' && !motivo) throw erroHttp(400, 'Informe o motivo do descarte.');
  const automatica = decisao === 'AUTOMATICA';
  const { count } = await comRetry(() => prisma.eventoTelemetria.updateMany({
    where: { id: { in: ids }, evento: EVENTOS.FADIGA },
    data: {
      validacao_fadiga: automatica ? null : decisao,
      validacao_motivo: automatica ? null : motivo,
      validado_por: automatica ? null : (req.atuante?.nome ?? null),
      validado_em: automatica ? null : new Date(),
    },
  }), 'validar');
  if (!count) return res.status(404).json({ error: 'Nao encontrado', message: 'Nenhuma deteccao de fadiga encontrada com esses IDs.' });
  await registrarLogAtividade(req, { acao: 'VALIDAR_FADIGA', modulo: MODULO_AUDITORIA, detalhes: { ids, decisao } }).catch(() => {});
  return res.status(200).json({ sucesso: true, atualizados: count, decisao });
});

// ============================================================================
// 2. HISTÓRICO DO CONDUTOR
// ============================================================================
export const historicoMotorista = asyncHandler(async (req, res) => {
  const motorista = texto(req.query.motorista, 255);
  if (!motorista) throw erroHttp(400, 'Informe o condutor em "motorista".');

  const [eventos, planos] = await Promise.all([
    comRetry(() => prisma.eventoTelemetria.findMany({
      where: { motorista },
      orderBy: [{ data_hora: 'desc' }, { id: 'asc' }],
      take: 5000,
    }), 'historico'),
    comRetry(() => prisma.planoAcaoTelemetria.findMany({ where: { motorista }, orderBy: { created_at: 'desc' } }), 'historico-planos'),
  ]);

  const deteccoes = eventos.filter((e) => e.evento === EVENTOS.FADIGA);
  const ocorrencias = analisarOcorrencias(deteccoes).map(semDeteccoes).reverse();
  // Excesso de velocidade por ocorrência (linhas a até 2 min), não por linha da plataforma.
  const ocorrenciasVelocidade = analisarOcorrenciasVelocidade(eventos.filter((e) => e.evento === EVENTOS.VELOCIDADE))
    .filter((o) => o.faixa !== 'NORMAL')
    .map(resumirOcorrenciaVelocidade)
    .reverse();

  const meses = new Map();
  const mes = (ref) => {
    if (!meses.has(ref)) {
      meses.set(ref, {
        mes: ref, fadiga_confirmada: 0, fadiga_em_analise: 0, fadiga_veiculo_parado: 0, fadiga_descartada: 0,
        sem_parada: 0, velocidade: 0, velocidade_moderado: 0, velocidade_grave: 0, velocidade_critico: 0,
        velocidade_abaixo_gatilho: 0, outros: 0,
      });
    }
    return meses.get(ref);
  };
  for (const o of ocorrenciasVelocidade) {
    const m = mes(mesLocal(o.inicio));
    if (o.classificacao === 'ABAIXO_GATILHO') m.velocidade_abaixo_gatilho += 1;
    if (o.classificacao !== 'CONFIRMADA') continue;
    m.velocidade += 1;
    m[`velocidade_${o.faixa.toLowerCase()}`] += 1;
  }
  for (const o of ocorrencias) {
    const m = mes(mesLocal(o.inicio));
    if (o.classificacao === CLASSIFICACAO_FADIGA.CONFIRMADA) m.fadiga_confirmada += 1;
    if (o.classificacao === CLASSIFICACAO_FADIGA.ANALISE) m.fadiga_em_analise += 1;
    if (o.classificacao === CLASSIFICACAO_FADIGA.PARADO) m.fadiga_veiculo_parado += 1;
    if (o.classificacao === CLASSIFICACAO_FADIGA.DESCARTADA) m.fadiga_descartada += 1;
    if (o.classificacao === CLASSIFICACAO_FADIGA.CONFIRMADA && o.sem_parada) m.sem_parada += 1;
  }
  for (const e of eventos) {
    if ([EVENTOS.FADIGA, EVENTOS.FADIGA_SEM_PARADA, EVENTOS.VELOCIDADE].includes(e.evento)) continue;
    mes(mesLocal(e.data_hora)).outros += 1;
  }

  return res.status(200).json({
    motorista,
    veiculos: [...new Set(eventos.map((e) => e.tag ? `${e.tag} · ${e.tag_placa}` : e.tag_placa))],
    total_eventos: eventos.length,
    resumo_mensal: [...meses.values()].sort((a, b) => b.mes.localeCompare(a.mes)),
    ocorrencias_fadiga: ocorrencias,
    ocorrencias_velocidade: ocorrenciasVelocidade,
    outros_eventos: eventos.filter((e) => ![EVENTOS.FADIGA, EVENTOS.VELOCIDADE].includes(e.evento)).slice(0, 200),
    planos,
  });
});

export const matrizFadiga = asyncHandler(async (_req, res) => res.status(200).json({
  matriz: MATRIZ_FADIGA,
  linhas: LINHAS_MATRIZ_FADIGA,
  notas: NOTAS_MATRIZ_FADIGA,
  criterios: {
    velocidade_minima_kmh: VELOCIDADE_MINIMA_FADIGA_KMH,
    janela_min: JANELA_FADIGA_MIN,
    prazo_padrao_dias: PRAZO_TRATATIVA_DIAS,
  },
}));

// ============================================================================
// 3. PLANOS DE AÇÃO
// ============================================================================
function lerAcoes(acoes) {
  if (acoes === undefined) return undefined;
  if (!Array.isArray(acoes)) throw erroHttp(400, '"acoes" deve ser uma lista.');
  if (acoes.length > 50) throw erroHttp(400, 'No maximo 50 acoes por plano.');
  return acoes
    .map((a) => ({
      descricao: texto(a?.descricao, 1000),
      responsavel: texto(a?.responsavel, 255),
      prazo: texto(a?.prazo, 10),
      concluida: Boolean(a?.concluida),
    }))
    .filter((a) => a.descricao);
}

function lerData(valor, campo) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) throw erroHttp(400, `"${campo}" deve estar no formato AAAA-MM-DD.`);
  return new Date(`${valor}T00:00:00Z`);
}

function prazoPadrao() {
  const d = new Date(Date.now() + FUSO_MS);
  d.setUTCDate(d.getUTCDate() + PRAZO_TRATATIVA_DIAS);
  return new Date(d.toISOString().slice(0, 10));
}

export const listarPlanos = asyncHandler(async (req, res) => {
  const where = {};
  const status = String(req.query.status || '').toUpperCase().split(',').filter(Boolean);
  if (status.length) where.status = { in: status };
  if (req.query.motorista) where.motorista = String(req.query.motorista);
  if (req.query.tipo) where.tipo = String(req.query.tipo).toUpperCase();
  const planos = await comRetry(() => prisma.planoAcaoTelemetria.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 }), 'planos');
  const vinculos = planos.length
    ? await comRetry(() => prisma.eventoTelemetria.groupBy({
      by: ['plano_acao_id'], where: { plano_acao_id: { in: planos.map((p) => p.id) } }, _count: { _all: true },
    }), 'planos-contagem')
    : [];
  const contagem = new Map(vinculos.map((v) => [v.plano_acao_id, v._count._all]));
  const hoje = new Date(new Date(Date.now() + FUSO_MS).toISOString().slice(0, 10));
  return res.status(200).json({
    planos: planos.map((p) => ({
      ...p,
      total_eventos: contagem.get(p.id) || 0,
      atrasado: ['ABERTO', 'EM_ANDAMENTO'].includes(p.status) && !!p.prazo && new Date(p.prazo) < hoje,
    })),
  });
});

export const criarPlano = asyncHandler(async (req, res) => {
  const dados = req.body || {};
  const motorista = texto(dados.motorista, 255);
  if (!motorista) throw erroHttp(400, 'Informe o condutor ("motorista") do plano de acao.');
  const tipo = String(dados.tipo || 'FADIGA').toUpperCase();
  if (!['FADIGA', 'VELOCIDADE'].includes(tipo)) throw erroHttp(400, 'Tipo de plano invalido. Aceitos: FADIGA, VELOCIDADE.');
  const linha = String(dados.linha_matriz || '').toUpperCase();
  const linhasAceitas = tipo === 'VELOCIDADE' ? LINHAS_MATRIZ_VELOCIDADE : Object.values(LINHAS_MATRIZ_FADIGA);
  if (!linhasAceitas.includes(linha)) {
    throw erroHttp(400, `Linha da matriz invalida. Aceitas: ${linhasAceitas.join(', ')}.`);
  }
  const nivel = Math.min(Math.max(parseInt(dados.nivel_recorrencia, 10) || 1, 1), 3);
  const elegivel = tipo === 'FADIGA' && dados.elegivel_prontidao !== undefined && dados.elegivel_prontidao !== null
    ? Boolean(dados.elegivel_prontidao) : null;
  const medidaPadrao = tipo === 'VELOCIDADE'
    ? medidaRecomendada(EVENTOS.VELOCIDADE, linha.replace('VELOCIDADE_', ''), nivel)
    : medidaFadiga(linha, nivel, elegivel !== false);
  const ids = dados.eventos_ids?.length ? idsValidos(dados.eventos_ids, 'eventos_ids') : [];

  if (ids.length) {
    const eventos = await comRetry(() => prisma.eventoTelemetria.findMany({
      where: { id: { in: ids } }, select: { id: true, motorista: true, plano_acao_id: true },
    }), 'plano-eventos');
    if (eventos.length !== ids.length) throw erroHttp(400, 'Algum evento informado nao existe mais.');
    const outros = eventos.filter((e) => e.motorista !== motorista);
    if (outros.length) throw erroHttp(400, 'Todos os eventos do plano devem ser do mesmo condutor.');
  }

  const plano = await comRetry(() => prisma.planoAcaoTelemetria.create({
    data: {
      tipo,
      motorista,
      tag_placa: texto(dados.tag_placa, 60),
      linha_matriz: linha,
      nivel_recorrencia: nivel,
      elegivel_prontidao: elegivel,
      medida_matriz: texto(dados.medida_matriz, 4000) || medidaPadrao,
      analise: texto(dados.analise, 10000),
      acoes: lerAcoes(dados.acoes) || [],
      responsavel: texto(dados.responsavel, 255),
      prazo: lerData(dados.prazo, 'prazo') ?? prazoPadrao(),
      status: 'ABERTO',
      criado_por: req.atuante?.nome ?? null,
    },
  }), 'plano-criar');

  if (ids.length) {
    await comRetry(() => prisma.eventoTelemetria.updateMany({ where: { id: { in: ids } }, data: { plano_acao_id: plano.id } }), 'plano-vincular');
  }
  await registrarLogAtividade(req, {
    acao: 'CRIAR_PLANO_ACAO_TELEMETRIA', modulo: MODULO_AUDITORIA, detalhes: { id: plano.id, motorista, linha, eventos: ids.length },
  }).catch(() => {});
  return res.status(201).json({ ...plano, total_eventos: ids.length });
});

export const atualizarPlano = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').toLowerCase();
  if (!UUID.test(id)) throw erroHttp(400, 'Identificador de plano invalido.');
  const atual = await comRetry(() => prisma.planoAcaoTelemetria.findUnique({ where: { id } }), 'plano-obter');
  if (!atual) return res.status(404).json({ error: 'Nao encontrado', message: 'Plano de acao nao encontrado.' });

  const dados = req.body || {};
  const alteracoes = {};
  if (dados.status !== undefined) {
    const status = String(dados.status).toUpperCase();
    if (!STATUS_PLANO.includes(status)) throw erroHttp(400, `Status invalido. Aceitos: ${STATUS_PLANO.join(', ')}.`);
    alteracoes.status = status;
    alteracoes.concluido_em = status === 'CONCLUIDO' ? (atual.concluido_em || new Date()) : null;
  }
  for (const [campo, max] of [['medida_matriz', 4000], ['analise', 10000], ['responsavel', 255], ['conclusao', 10000]]) {
    if (dados[campo] !== undefined) alteracoes[campo] = texto(dados[campo], max);
  }
  if (alteracoes.medida_matriz === null) throw erroHttp(400, 'A medida do plano nao pode ficar vazia.');
  const acoes = lerAcoes(dados.acoes);
  if (acoes !== undefined) alteracoes.acoes = acoes;
  const prazo = lerData(dados.prazo, 'prazo');
  if (prazo !== undefined) alteracoes.prazo = prazo;
  if (alteracoes.status === 'CONCLUIDO' && !(alteracoes.conclusao ?? atual.conclusao)) {
    throw erroHttp(400, 'Descreva a conclusao do plano (evidencias da medida aplicada) para concluir.');
  }

  const plano = await comRetry(() => prisma.planoAcaoTelemetria.update({ where: { id }, data: alteracoes }), 'plano-atualizar');
  // Plano concluído = tratativa dos eventos vinculados concluída com a medida do Anexo I.
  if (alteracoes.status === 'CONCLUIDO') {
    await comRetry(() => prisma.eventoTelemetria.updateMany({
      where: { plano_acao_id: id },
      data: { status_tratativa: 'TRATADO', medida_aplicada: plano.medida_matriz, tratado_por: req.atuante?.nome ?? null, tratado_em: new Date() },
    }), 'plano-concluir');
  }
  await registrarLogAtividade(req, {
    acao: 'ATUALIZAR_PLANO_ACAO_TELEMETRIA', modulo: MODULO_AUDITORIA, detalhes: { id, campos: Object.keys(alteracoes) },
  }).catch(() => {});
  return res.status(200).json(plano);
});

export const excluirPlano = asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').toLowerCase();
  if (!UUID.test(id)) throw erroHttp(400, 'Identificador de plano invalido.');
  // Desvincula os eventos antes (o banco também faz SET NULL).
  await comRetry(() => prisma.eventoTelemetria.updateMany({ where: { plano_acao_id: id }, data: { plano_acao_id: null } }), 'plano-desvincular');
  const { count } = await comRetry(() => prisma.planoAcaoTelemetria.deleteMany({ where: { id } }), 'plano-excluir');
  if (!count) return res.status(404).json({ error: 'Nao encontrado', message: 'Plano de acao nao encontrado.' });
  await registrarLogAtividade(req, { acao: 'EXCLUIR_PLANO_ACAO_TELEMETRIA', modulo: MODULO_AUDITORIA, detalhes: { id } }).catch(() => {});
  return res.status(200).json({ sucesso: true });
});
