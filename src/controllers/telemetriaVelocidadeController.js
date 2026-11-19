// ============================================================================
// src/controllers/telemetriaVelocidadeController.js — Análise de Excesso de
// Velocidade (PGS-007245 Rev. 03, Anexo I — "Velocidade").
//
//   GET   /api/telemetria/velocidade?horas=&inicio=&fim=&busca=&classificacao=&faixa=
//         Ocorrências (linhas do mesmo veículo a até 2 min), farol (TOLERANCIA |
//         ABAIXO_GATILHO | CONFIRMADA | DESCARTADA), faixa do Anexo I, recorrência no mês
//         por condutor e faixa, medida, plano vinculado, KPIs, ranking, cercas e horário.
//   PATCH /api/telemetria/velocidade/validacao { ids, decisao: CONFIRMADA|DESCARTADA|AUTOMATICA, motivo? }
//   GET   /api/telemetria/matriz-velocidade
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { filtroContrato } from '../middleware/escopo.js';
import { registrarLogAtividade } from '../services/auditService.js';
import { comRetryConexao } from '../utils/retryBanco.js';
import { erroHttp } from '../services/telemetriaPlanilhaService.js';
import { lerSemanasOuErro, montarFiltro } from './telemetriaController.js';
import {
  CLASSIFICACAO_VELOCIDADE,
  DURACAO_MINIMA_VELOCIDADE_S,
  EVENTOS,
  JANELA_VELOCIDADE_MIN,
  MATRIZ_VELOCIDADE,
  agruparOcorrenciasVelocidade,
  medidaRecomendada,
} from '../utils/classificacaoTelemetria.js';

const FUSO_MS = -3 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLASSIFICACOES = Object.values(CLASSIFICACAO_VELOCIDADE);
const FAIXAS = ['MODERADO', 'GRAVE', 'CRITICO'];

const comRetry = (fn, rotulo) => comRetryConexao(fn, 3, 700, `telemetria-velocidade:${rotulo}`);

const CAMPOS_LINHA = {
  id: true, tag_placa: true, tag: true, motorista: true, data_hora: true, valor: true, limite: true,
  percentual_excesso: true, severidade: true, duracao_s: true, cerca: true, localizacao: true,
  latitude: true, longitude: true, link_mapa: true, validacao_fadiga: true, plano_acao_id: true, evento_original: true,
};

function mesLocal(data) {
  return new Date(new Date(data).getTime() + FUSO_MS).toISOString().slice(0, 7);
}

function horaLocal(data) {
  return new Date(new Date(data).getTime() + FUSO_MS).getUTCHours();
}

function inicioDoMesDe(data) {
  const [ano, mes] = mesLocal(data).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, 1) - FUSO_MS);
}

/**
 * Ocorrências com recorrência no mês por condutor e faixa (cada linha da matriz tem a sua
 * progressão) e a medida do Anexo I. Só as CONFIRMADAS contam na recorrência.
 */
export function analisarOcorrenciasVelocidade(linhas) {
  const ocorrencias = agruparOcorrenciasVelocidade(linhas);
  const contagem = new Map();
  for (const o of ocorrencias) {
    const p = o.pior;
    o.tag = o.linhas.find((l) => l.tag)?.tag ?? null;
    o.cerca = p.cerca ?? null;
    o.latitude = p.latitude ?? null;
    o.longitude = p.longitude ?? null;
    o.localizacao = p.localizacao ?? null;
    o.link_mapa = p.link_mapa ?? null;
    o.plano_acao_id = o.linhas.map((l) => l.plano_acao_id).find(Boolean) || null;
    o.ids = o.linhas.map((l) => l.id);
    o.ocorrencia_no_mes = null;
    o.medida = null;
    if (o.classificacao !== CLASSIFICACAO_VELOCIDADE.CONFIRMADA || !o.motorista) continue;
    const chave = `${o.motorista}|${o.faixa}|${mesLocal(o.inicio)}`;
    const n = (contagem.get(chave) || 0) + 1;
    contagem.set(chave, n);
    o.ocorrencia_no_mes = n;
    o.medida = medidaRecomendada(EVENTOS.VELOCIDADE, o.faixa, n);
  }
  return ocorrencias;
}

/** Versão enxuta para a resposta (sem o detalhe de cada linha). */
export function resumirOcorrenciaVelocidade(o) {
  const { linhas, pior, ...resto } = o;
  return {
    ...resto,
    linhas: linhas.map((l) => ({ id: l.id, data_hora: l.data_hora, valor: l.valor, limite: l.limite, duracao_s: l.duracao_s, evento_original: l.evento_original })),
  };
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

export const analiseVelocidade = asyncHandler(async (req, res) => {
  const agora = new Date();
  const { classificacao, faixa, evento, severidade, semanas, ...filtros } = req.query;
  const where = { ...montarFiltro(filtros, agora), evento: EVENTOS.VELOCIDADE };
  const intervalo = where.data_hora;
  if (intervalo?.gte) where.data_hora = { ...intervalo, gte: inicioDoMesDe(intervalo.gte) };
  // Semanas selecionadas: lê desde o início do mês da primeira (a recorrência é mensal) e
  // depois mostra só as ocorrências que começam dentro das semanas escolhidas.
  const selecao = lerSemanasOuErro(semanas);
  if (selecao) where.data_hora = { gte: inicioDoMesDe(selecao.inicio), lt: selecao.fim };

  const linhas = await comRetry(() => prisma.eventoTelemetria.findMany({
    where, select: CAMPOS_LINHA, orderBy: [{ data_hora: 'asc' }, { id: 'asc' }], take: 20000,
  }), 'velocidade');

  let ocorrencias = analisarOcorrenciasVelocidade(linhas);
  if (intervalo?.gte) ocorrencias = ocorrencias.filter((o) => new Date(o.fim) >= intervalo.gte);
  if (selecao) ocorrencias = ocorrencias.filter((o) => selecao.contem(o.inicio));

  const filtroClass = String(classificacao || '').toUpperCase().split(',').filter(Boolean);
  const filtroFaixa = String(faixa || '').toUpperCase().split(',').filter(Boolean);
  if (filtroClass.some((c) => !CLASSIFICACOES.includes(c))) throw erroHttp(400, `Classificacao invalida. Aceitas: ${CLASSIFICACOES.join(', ')}.`);
  if (filtroFaixa.some((f) => !FAIXAS.includes(f))) throw erroHttp(400, `Faixa invalida. Aceitas: ${FAIXAS.join(', ')}.`);

  const porClassificacao = Object.fromEntries(CLASSIFICACOES.map((c) => [c, 0]));
  ocorrencias.forEach((o) => { porClassificacao[o.classificacao] += 1; });
  const confirmadas = ocorrencias.filter((o) => o.classificacao === CLASSIFICACAO_VELOCIDADE.CONFIRMADA);
  const porFaixa = Object.fromEntries(FAIXAS.map((f) => [f, confirmadas.filter((o) => o.faixa === f).length]));

  // Ranking por condutor: confirmadas por faixa e maior recorrência no mês (3+ ou Crítico = Comitê).
  const ranking = new Map();
  for (const o of confirmadas) {
    const chave = o.motorista || o.tag_placa;
    const r = ranking.get(chave) || {
      motorista: o.motorista, tag: o.tag, placa: o.tag_placa, confirmadas: 0, MODERADO: 0, GRAVE: 0, CRITICO: 0, nivel_max: 0, sem_plano: 0,
    };
    r.confirmadas += 1;
    r[o.faixa] += 1;
    r.nivel_max = Math.max(r.nivel_max, o.ocorrencia_no_mes || 0);
    if (!o.plano_acao_id) r.sem_plano += 1;
    ranking.set(chave, r);
  }
  const listaRanking = [...ranking.values()].map((r) => ({ ...r, comite: r.CRITICO > 0 || r.nivel_max >= 3 }));

  // Onde e quando: cercas e horário das ocorrências com conduta (confirmadas + abaixo do gatilho).
  const comConduta = ocorrencias.filter((o) => o.faixa !== 'NORMAL' && o.classificacao !== CLASSIFICACAO_VELOCIDADE.DESCARTADA);
  const cercas = new Map();
  for (const o of comConduta) {
    const chave = `${o.cerca || 'Sem cerca'}|${o.limite ?? ''}`;
    const c = cercas.get(chave) || { cerca: o.cerca || 'Sem cerca', limite: o.limite, ocorrencias: 0, confirmadas: 0, condutores: new Set() };
    c.ocorrencias += 1;
    if (o.classificacao === CLASSIFICACAO_VELOCIDADE.CONFIRMADA) c.confirmadas += 1;
    if (o.motorista) c.condutores.add(o.motorista);
    cercas.set(chave, c);
  }
  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, ocorrencias: 0, confirmadas: 0 }));
  for (const o of comConduta) {
    const h = porHora[horaLocal(o.inicio)];
    h.ocorrencias += 1;
    if (o.classificacao === CLASSIFICACAO_VELOCIDADE.CONFIRMADA) h.confirmadas += 1;
  }

  let visiveis = ocorrencias;
  if (filtroClass.length) visiveis = visiveis.filter((o) => filtroClass.includes(o.classificacao));
  if (filtroFaixa.length) visiveis = visiveis.filter((o) => filtroFaixa.includes(o.faixa));
  const planos = await planosPorId(visiveis.map((o) => o.plano_acao_id));

  return res.status(200).json({
    criterios: { janela_min: JANELA_VELOCIDADE_MIN, duracao_minima_s: DURACAO_MINIMA_VELOCIDADE_S },
    kpis: {
      linhas: ocorrencias.reduce((s, o) => s + o.linhas.length, 0),
      ocorrencias: ocorrencias.length,
      por_classificacao: porClassificacao,
      confirmadas_por_faixa: porFaixa,
      condutores_comite: listaRanking.filter((r) => r.comite).length,
      confirmadas_sem_plano: confirmadas.filter((o) => !o.plano_acao_id).length,
    },
    ocorrencias: visiveis
      .map((o) => ({ ...resumirOcorrenciaVelocidade(o), plano_acao: o.plano_acao_id ? planos.get(o.plano_acao_id) || null : null }))
      .sort((a, b) => new Date(b.inicio) - new Date(a.inicio)),
    ranking_condutores: listaRanking
      .sort((a, b) => Number(b.comite) - Number(a.comite) || b.CRITICO - a.CRITICO || b.GRAVE - a.GRAVE || b.confirmadas - a.confirmadas)
      .slice(0, 15),
    cercas: [...cercas.values()]
      .map(({ condutores, ...c }) => ({ ...c, condutores: condutores.size }))
      .sort((a, b) => b.ocorrencias - a.ocorrencias)
      .slice(0, 10),
    por_hora: porHora,
  });
});

export const validarVelocidade = asyncHandler(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw erroHttp(400, 'Envie "ids" (1 a 500 eventos).');
  const lista = [...new Set(ids.map((id) => String(id).toLowerCase()))];
  if (lista.some((id) => !UUID.test(id))) throw erroHttp(400, 'Identificador invalido em "ids".');
  const decisao = String(req.body?.decisao || '').toUpperCase();
  if (!['CONFIRMADA', 'DESCARTADA', 'AUTOMATICA'].includes(decisao)) {
    throw erroHttp(400, 'Informe "decisao": CONFIRMADA, DESCARTADA ou AUTOMATICA (volta ao farol automatico).');
  }
  const motivo = req.body?.motivo ? String(req.body.motivo).trim().slice(0, 2000) : null;
  if (decisao === 'DESCARTADA' && !motivo) throw erroHttp(400, 'Informe o motivo do descarte.');
  const automatica = decisao === 'AUTOMATICA';
  // A validação da Central usa as mesmas colunas da fadiga (validacao_fadiga etc.).
  const { count } = await comRetry(() => prisma.eventoTelemetria.updateMany({
    where: { id: { in: lista }, evento: EVENTOS.VELOCIDADE, ...filtroContrato(req) },
    data: {
      validacao_fadiga: automatica ? null : decisao,
      validacao_motivo: automatica ? null : motivo,
      validado_por: automatica ? null : (req.atuante?.nome ?? null),
      validado_em: automatica ? null : new Date(),
    },
  }), 'validar');
  if (!count) return res.status(404).json({ error: 'Nao encontrado', message: 'Nenhum excesso de velocidade encontrado com esses IDs.' });
  await registrarLogAtividade(req, { acao: 'VALIDAR_VELOCIDADE', modulo: 'TELEMETRIA', detalhes: { ids: lista, decisao } }).catch(() => {});
  return res.status(200).json({ sucesso: true, atualizados: count, decisao });
});

export const matrizVelocidade = asyncHandler(async (_req, res) => res.status(200).json({
  matriz: MATRIZ_VELOCIDADE,
  criterios: { janela_min: JANELA_VELOCIDADE_MIN, duracao_minima_s: DURACAO_MINIMA_VELOCIDADE_S, tolerancia_percentual: 7 },
}));
