// ============================================================================
// src/controllers/telemetriaController.js — Telemetria & Fadiga (PGS-007245 Rev. 03).
//
//   GET    /api/telemetria?busca=&horas=24&evento=a,b&severidade=&status=&tag=&inicio=&fim=&pagina=&limite=
//          Lista os eventos com ocorrência no mês, medida recomendada (Anexo I) e atraso.
//   GET    /api/telemetria/resumo (mesmos filtros)
//          KPIs (com a janela anterior quando há `horas`), agrupamentos, Top 5 de
//          veículos, alerta de risco do dia e % de fadigas sem parada obrigatória.
//   POST   /api/telemetria/importar (multipart `arquivo`; confirmar=true grava, senão só a prévia)
//   POST   /api/telemetria                 -> lançamento manual
//   PATCH  /api/telemetria/:id/tratativa   -> { status_tratativa, medida_aplicada?, observacao? }
//   POST   /api/telemetria/excluir-lote | DELETE /api/telemetria/lote -> { ids }
//   DELETE /api/telemetria/:id
//   GET    /api/telemetria/trajeto?veiculo=&dataInicio=&dataFim=&horaInicio=&horaFim=
//   GET    /api/telemetria/placas-nao-cadastradas
//   DELETE /api/telemetria/por-placa/:placa  (Master, Gestão e Transporte)
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { registrarLogAtividade } from '../services/auditService.js';
import { comRetryConexao } from '../utils/retryBanco.js';
import * as regras from '../utils/classificacaoTelemetria.js';
import {
  FUSO_PADRAO_MIN,
  chavePlaca,
  chaveUnica,
  contarPor,
  erroHttp,
  extrairEventos,
  lerLinhas,
} from '../services/telemetriaPlanilhaService.js';
import { lerSemanas, semanaISO, semanasAnteriores } from '../utils/semanasTelemetria.js';
import {
  filtroDataHoraTrajeto,
  indexarFrota,
  lerFiltroTrajeto,
  normalizarPlaca,
  placasSemCadastro,
  statusMobilizacao,
  trechoBuscaPlaca,
} from '../services/telemetriaTrajetoService.js';

const { EVENTOS, LISTA_EVENTOS, SEVERIDADES, STATUS_TRATATIVA } = regras;

const MODULO_AUDITORIA = 'TELEMETRIA';
const TAMANHO_LOTE_INSERT = 1000;
const HORA_MS = 60 * 60 * 1000;
/** Datas da tela (AAAA-MM-DD) e "mês de registro" da recorrência em -03:00. */
const FUSO_MS = -3 * HORA_MS;
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const comRetry = (fn, rotulo) => comRetryConexao(fn, 3, 700, `telemetria:${rotulo}`);

// ============================================================================
// 1. FILTROS E DATAS
// ============================================================================

function idValido(id) {
  if (!UUID.test(String(id || ''))) throw erroHttp(400, 'Identificador de evento invalido.');
  return String(id).toLowerCase();
}

/** "a,b" ou ["a","b"] -> lista sem vazios. */
function lista(valor) {
  if (valor === undefined || valor === null || valor === '') return [];
  return (Array.isArray(valor) ? valor : String(valor).split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);
}

function listaValidada(valor, aceitos, campo) {
  const itens = lista(valor);
  const invalidos = itens.filter((i) => !aceitos.includes(i));
  if (invalidos.length) {
    throw erroHttp(400, `Valor invalido em "${campo}": ${invalidos.join(', ')}. Aceitos: ${aceitos.join(', ')}.`);
  }
  return itens;
}

/** Data de hoje em -03:00, como meia-noite UTC (formato das colunas DATE). */
function hoje(agora = new Date()) {
  return new Date(new Date(agora.getTime() + FUSO_MS).toISOString().slice(0, 10));
}

/** "AAAA-MM-DD" -> início do dia em -03:00 (ou do dia seguinte). */
function inicioDoDia(texto, campo, diaSeguinte = false) {
  const m = String(texto).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw erroHttp(400, `O campo "${campo}" deve estar no formato AAAA-MM-DD.`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (diaSeguinte ? 1 : 0)) - FUSO_MS);
}

function mesDoEvento(data) {
  return new Date(new Date(data).getTime() + FUSO_MS).toISOString().slice(0, 7);
}

function inicioDoMes(referencia, meses = 0) {
  const [ano, mes] = referencia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1 + meses, 1) - FUSO_MS);
}

/** Semanas do filtro (ou null); semana inválida vira 400. */
export function lerSemanasOuErro(valor) {
  try {
    return lerSemanas(valor);
  } catch (erro) {
    throw erroHttp(400, erro.message);
  }
}

/** `where` do Prisma a partir dos filtros da tela. */
export function montarFiltro(query = {}, agora = new Date()) {
  const where = {};
  const busca = String(query.busca || '').trim();
  if (busca) {
    where.OR = ['tag_placa', 'tag', 'localizacao', 'motorista'].map((campo) => ({
      [campo]: { contains: busca, mode: 'insensitive' },
    }));
  }
  if (query.tag) where.tag = String(query.tag).trim();
  if (query.motorista) where.motorista = { contains: String(query.motorista).trim(), mode: 'insensitive' };
  const eventos = listaValidada(query.evento, LISTA_EVENTOS, 'evento');
  if (eventos.length) where.evento = { in: eventos };
  const severidades = listaValidada(query.severidade && String(query.severidade).toUpperCase(), SEVERIDADES, 'severidade');
  if (severidades.length) where.severidade = { in: severidades };
  const status = listaValidada(query.status && String(query.status).toUpperCase(), STATUS_TRATATIVA, 'status');
  if (status.length) where.status_tratativa = { in: status };
  if (query.inicio || query.fim) {
    where.data_hora = {};
    if (query.inicio) where.data_hora.gte = inicioDoDia(query.inicio, 'inicio');
    if (query.fim) where.data_hora.lt = inicioDoDia(query.fim, 'fim', true);
  }
  // Janela móvel ("últimas 24 h"); prevalece sobre inicio/fim.
  if (query.horas !== undefined && query.horas !== '') {
    const horas = Number(query.horas);
    if (!Number.isFinite(horas) || horas <= 0 || horas > 24 * 366) {
      throw erroHttp(400, 'O campo "horas" deve ser um numero de horas maior que zero.');
    }
    where.data_hora = { gte: new Date(agora.getTime() - horas * HORA_MS), lte: agora };
  }
  // Semanas do ano selecionadas ("2026-44,2026-45"): podem não ser contíguas, então cada uma
  // vira um intervalo dentro de um OR (em AND para não colidir com o OR da busca).
  const semanas = lerSemanasOuErro(query.semanas);
  if (semanas) {
    where.AND = [...(where.AND || []), { OR: semanas.intervalos.map((i) => ({ data_hora: { gte: i.inicio, lt: i.fim } })) }];
  }
  if (query.atrasados === 'true') {
    where.status_tratativa = 'PENDENTE';
    where.prazo_tratativa = { lt: hoje(agora) };
  }
  return where;
}

// ============================================================================
// 2. RECORRÊNCIA E MEDIDA RECOMENDADA (ANEXO I)
// ============================================================================

/**
 * Ordem de cada evento entre os do mesmo motorista, tipo e severidade no mês
 * (recorrência: dois ou mais eventos do mesmo tipo no mês de registro).
 * Recebe o histórico ordenado por data; devolve Map id -> ocorrência (1, 2, 3...).
 */
export function calcularOcorrencias(historico) {
  const contagem = new Map();
  const ocorrencias = new Map();
  for (const e of historico) {
    if (!e.motorista || e.severidade === 'NORMAL') continue;
    const chave = `${e.motorista}|${e.evento}|${e.severidade}|${mesDoEvento(e.data_hora)}`;
    const n = (contagem.get(chave) || 0) + 1;
    contagem.set(chave, n);
    ocorrencias.set(e.id, n);
  }
  return ocorrencias;
}

async function enriquecer(eventos) {
  const comConduta = eventos.filter((e) => e.motorista && e.severidade !== 'NORMAL');
  let ocorrencias = new Map();
  if (comConduta.length) {
    const meses = comConduta.map((e) => mesDoEvento(e.data_hora)).sort();
    const historico = await comRetry(() => prisma.eventoTelemetria.findMany({
      where: {
        motorista: { in: [...new Set(comConduta.map((e) => e.motorista))] },
        evento: { in: [...new Set(comConduta.map((e) => e.evento))] },
        data_hora: { gte: inicioDoMes(meses[0]), lt: inicioDoMes(meses[meses.length - 1], 1) },
        status_tratativa: { not: 'DESCARTADO' },
      },
      select: { id: true, motorista: true, evento: true, severidade: true, data_hora: true },
      orderBy: [{ data_hora: 'asc' }, { id: 'asc' }],
    }), 'recorrencia');
    ocorrencias = calcularOcorrencias(historico);
  }
  const dataHoje = hoje();
  return eventos.map((e) => {
    const ocorrencia = ocorrencias.get(e.id) ?? (e.severidade === 'NORMAL' ? null : 1);
    return {
      ...e,
      ocorrencia_no_mes: e.motorista ? ocorrencia : null,
      medida_recomendada: regras.medidaRecomendada(e.evento, e.severidade, ocorrencia),
      atrasado: e.status_tratativa === 'PENDENTE' && !!e.prazo_tratativa && new Date(e.prazo_tratativa) < dataHoje,
    };
  });
}

function prazoPadrao(dataBase = new Date()) {
  const prazo = hoje(dataBase);
  prazo.setUTCDate(prazo.getUTCDate() + regras.PRAZO_TRATATIVA_DIAS);
  return prazo;
}

// ============================================================================
// 3. LISTAGEM E RESUMO
// ============================================================================

export const listarEventosTelemetria = asyncHandler(async (req, res) => {
  const pagina = Math.max(parseInt(req.query.pagina, 10) || 1, 1);
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  const where = montarFiltro(req.query);
  const [eventos, total] = await comRetry(() => prisma.$transaction([
    prisma.eventoTelemetria.findMany({
      where,
      orderBy: [{ data_hora: 'desc' }, { id: 'asc' }],
      skip: (pagina - 1) * limite,
      take: limite,
    }),
    prisma.eventoTelemetria.count({ where }),
  ]), 'listar');

  return res.status(200).json({
    eventos: await enriquecer(eventos),
    paginacao: { pagina, limite, total, total_paginas: Math.max(Math.ceil(total / limite), 1) },
  });
});

async function contarCartoes(where) {
  // Casos de fadiga = fadiga detectada com o veículo em movimento (>= 10 km/h, gatilho do PGS).
  // Detecções com o veículo parado ficam à parte: não entram na Matriz de Condutas.
  const [total, graves, fadiga, fadigaParado, velocidade] = await comRetry(() => prisma.$transaction([
    prisma.eventoTelemetria.count({ where }),
    prisma.eventoTelemetria.count({ where: { ...where, severidade: { in: ['GRAVE', 'CRITICO'] } } }),
    prisma.eventoTelemetria.count({ where: { ...where, evento: EVENTOS.FADIGA, valor: { gte: regras.VELOCIDADE_MINIMA_FADIGA_KMH } } }),
    prisma.eventoTelemetria.count({
      where: { AND: [where, { evento: EVENTOS.FADIGA, OR: [{ valor: null }, { valor: { lt: regras.VELOCIDADE_MINIMA_FADIGA_KMH } }] }] },
    }),
    prisma.eventoTelemetria.count({ where: { ...where, evento: EVENTOS.VELOCIDADE } }),
  ]), 'kpis');
  return { total, graves, fadiga, fadiga_veiculo_parado: fadigaParado, velocidade };
}

/** Top 5 de veículos com mais infrações (eventos com conduta), com quantas são graves/críticas. */
async function topVeiculos(where) {
  const comConduta = { ...where, severidade: { ...(where.severidade || {}), not: 'NORMAL' } };
  const [todos, graves] = await comRetry(() => prisma.$transaction([
    prisma.eventoTelemetria.groupBy({ by: ['tag_placa', 'tag'], where: comConduta, _count: { _all: true } }),
    prisma.eventoTelemetria.groupBy({
      by: ['tag_placa', 'tag'],
      where: { ...comConduta, severidade: { in: ['GRAVE', 'CRITICO'] } },
      _count: { _all: true },
    }),
  ]), 'top5');
  const gravesPorPlaca = new Map(graves.map((g) => [g.tag_placa, g._count._all]));
  return todos
    .map((g) => ({ tag: g.tag, placa: g.tag_placa, total: g._count._all, graves: gravesPorPlaca.get(g.tag_placa) || 0 }))
    .sort((a, b) => b.graves - a.graves || b.total - a.total || a.placa.localeCompare(b.placa))
    .slice(0, 5);
}

/** Quem teve evento grave/crítico desde 00:00 (-03:00), os de mais críticos primeiro. */
async function alertaDeRiscoHoje(query, agora) {
  const { horas, inicio, fim, semanas, severidade, ...outros } = query;
  const eventos = await comRetry(() => prisma.eventoTelemetria.findMany({
    where: {
      ...montarFiltro(outros, agora),
      severidade: { in: ['GRAVE', 'CRITICO'] },
      status_tratativa: { not: 'DESCARTADO' },
      data_hora: { gte: new Date(hoje(agora).getTime() - FUSO_MS), lte: agora },
    },
    select: { motorista: true, tag_placa: true, tag: true, evento: true, severidade: true, data_hora: true },
    orderBy: { data_hora: 'desc' },
    take: 1000,
  }), 'alerta');
  const grupos = new Map();
  for (const e of eventos) {
    const chave = e.motorista || e.tag_placa;
    const g = grupos.get(chave) || {
      motorista: e.motorista, tag: e.tag, placa: e.tag_placa, eventos: 0, criticos: 0, ultimo_evento: e.evento, ultimo_horario: e.data_hora,
    };
    g.eventos += 1;
    if (e.severidade === 'CRITICO') g.criticos += 1;
    grupos.set(chave, g);
  }
  return [...grupos.values()]
    .sort((a, b) => b.criticos - a.criticos || b.eventos - a.eventos || b.ultimo_horario - a.ultimo_horario)
    .slice(0, 10);
}

export const resumoTelemetria = asyncHandler(async (req, res) => {
  const agora = new Date();
  const where = montarFiltro(req.query, agora);
  // Dados existentes sem o filtro de data: a tela avisa quando o período escolhido está vazio.
  const { horas: _semJanela, inicio: _semInicio, fim: _semFim, semanas: _semSemanas, ...semPeriodo } = req.query;
  const [kpis, porEvento, porSeveridade, top5, alerta, disponiveis] = await Promise.all([
    contarCartoes(where),
    comRetry(() => prisma.eventoTelemetria.groupBy({ by: ['evento'], where, _count: { _all: true } }), 'por_evento'),
    comRetry(() => prisma.eventoTelemetria.groupBy({ by: ['severidade'], where, _count: { _all: true } }), 'por_severidade'),
    topVeiculos(where),
    alertaDeRiscoHoje(req.query, agora),
    comRetry(() => prisma.eventoTelemetria.aggregate({
      where: montarFiltro(semPeriodo, agora), _count: { _all: true }, _min: { data_hora: true }, _max: { data_hora: true },
    }), 'disponiveis'),
  ]);

  let anterior = null;
  const horas = Number(req.query.horas) || null;
  const semanas = lerSemanasOuErro(req.query.semanas);
  if (semanas) {
    // Compara com o mesmo número de semanas imediatamente antes das selecionadas.
    anterior = await contarCartoes(montarFiltro({ ...semPeriodo, semanas: semanasAnteriores(semanas.intervalos).join(',') }, agora));
  } else if (horas) {
    anterior = await contarCartoes({
      ...montarFiltro(semPeriodo, agora),
      data_hora: { gte: new Date(agora.getTime() - 2 * horas * HORA_MS), lt: new Date(agora.getTime() - horas * HORA_MS) },
    });
  }

  const eventos = Object.fromEntries(porEvento.map((g) => [g.evento, g._count._all]));
  const fadigas = eventos[EVENTOS.FADIGA] || 0;
  const semParada = eventos[EVENTOS.FADIGA_SEM_PARADA] || 0;
  return res.status(200).json({
    kpis: { ...kpis, janela_horas: semanas ? null : horas, semanas: semanas ? semanas.intervalos.map((i) => i.chave) : null, anterior },
    dados_disponiveis: {
      total: disponiveis._count._all,
      inicio: disponiveis._min.data_hora,
      fim: disponiveis._max.data_hora,
    },
    por_evento: eventos,
    por_severidade: {
      ...Object.fromEntries(SEVERIDADES.map((s) => [s, 0])),
      ...Object.fromEntries(porSeveridade.map((g) => [g.severidade, g._count._all])),
    },
    fadiga: {
      eventos: fadigas,
      sem_parada_obrigatoria: semParada,
      percentual_sem_parada: fadigas ? Math.round((semParada / fadigas) * 10000) / 100 : null,
    },
    top_veiculos: top5,
    alerta_risco_hoje: alerta,
  });
});

// ============================================================================
// 4. IMPORTAÇÃO (PRÉVIA + CONFIRMAÇÃO)
// ============================================================================

async function carregarVeiculosPorPlaca() {
  const veiculos = await comRetry(() => prisma.mobDesmob.findMany({ select: { tag: true, placa: true } }), 'frota');
  const mapa = new Map();
  for (const v of veiculos) {
    const chave = chavePlaca(v.placa);
    if (chave && !mapa.has(chave)) mapa.set(chave, v);
    // A planilha modelo aceita a TAG no lugar da placa (coluna TAG/PLACA).
    const chaveTag = chavePlaca(v.tag);
    if (chaveTag && !mapa.has(chaveTag)) mapa.set(chaveTag, v);
  }
  return mapa;
}

/**
 * Reimportar a planilha corrige o que já está gravado (createMany pula os duplicados):
 *  - atualiza a parada obrigatória apurada (parou_em_15_min) das fadigas da planilha;
 *  - remove "Fadiga sem Parada Obrigatória" derivados, no período e veículos da planilha,
 *    que a apuração atual não gera mais (ex.: fadiga com o veículo parado).
 * Devolve quantos registros foram ajustados.
 */
export async function reconciliarFadiga(registros) {
  const fadigas = registros.filter((r) => r.evento === EVENTOS.FADIGA);
  if (!fadigas.length) return { parada_atualizada: 0, sem_parada_removidos: 0 };

  let paradaAtualizada = 0;
  for (const valor of [true, false, null]) {
    const chaves = fadigas.filter((f) => (f.parou_em_15_min ?? null) === valor).map((f) => f.chave_unica);
    if (!chaves.length) continue;
    // Só o que muda (NULL precisa de condição explícita: NOT (col = true) não pega NULL no SQL).
    const diferente = valor === null
      ? { parou_em_15_min: { not: null } }
      : { OR: [{ parou_em_15_min: null }, { parou_em_15_min: !valor }] };
    const { count } = await comRetry(() => prisma.eventoTelemetria.updateMany({
      where: { AND: [{ chave_unica: { in: chaves } }, diferente] },
      data: { parou_em_15_min: valor },
    }), 'reconciliar-parada');
    paradaAtualizada += count;
  }

  const derivadosAtuais = registros
    .filter((r) => r.evento === EVENTOS.FADIGA_SEM_PARADA && r.origem === 'DERIVADO')
    .map((r) => r.chave_unica);
  const tempos = fadigas.map((f) => f.data_hora.getTime());
  const { count: removidos } = await comRetry(() => prisma.eventoTelemetria.deleteMany({
    where: {
      evento: EVENTOS.FADIGA_SEM_PARADA,
      origem: 'DERIVADO',
      tag_placa: { in: [...new Set(fadigas.map((f) => f.tag_placa))] },
      data_hora: { gte: new Date(Math.min(...tempos)), lte: new Date(Math.max(...tempos) + 15 * 60 * 1000) },
      chave_unica: { notIn: derivadosAtuais },
    },
  }), 'reconciliar-derivados');

  return { parada_atualizada: paradaAtualizada, sem_parada_removidos: removidos };
}

function sim(valor) {
  return valor === true || ['true', '1', 'sim'].includes(String(valor ?? '').toLowerCase());
}

export const importarTelemetria = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({
      error: 'Arquivo nao enviado',
      message: 'Envie a planilha da plataforma de telemetria (.xlsx, .xls ou .csv) no campo `arquivo`.',
    });
  }
  const opcoes = { ...req.query, ...req.body };
  const fusoMin = opcoes.fuso_min !== undefined ? Number(opcoes.fuso_min) : FUSO_PADRAO_MIN;
  if (!Number.isInteger(fusoMin) || Math.abs(fusoMin) > 14 * 60) {
    throw erroHttp(400, 'O campo "fuso_min" deve ser o deslocamento do fuso em minutos (ex.: -180).');
  }

  const planilha = lerLinhas(req.file.buffer);
  const veiculosPorPlaca = await carregarVeiculosPorPlaca();
  const { eventos, ignoradas, invalidas, fadiga } = extrairEventos(planilha, {
    fusoMin,
    arquivo: req.file.originalname,
    veiculosPorPlaca,
  });
  const placasSemVeiculo = [...new Set(eventos.filter((e) => !e.tag).map((e) => e.tag_placa))].sort();

  const resultado = {
    sucesso: true,
    confirmado: false,
    arquivo: req.file.originalname || null,
    aba: planilha.aba,
    linhas_lidas: planilha.linhas.length,
    linhas_sem_conduta: ignoradas,
    linhas_invalidas: invalidas.length,
    avisos: invalidas.slice(0, 50),
    total_eventos: eventos.length,
    por_evento: contarPor(eventos, 'evento'),
    por_severidade: contarPor(eventos, 'severidade'),
    fadiga,
    placas_sem_veiculo: placasSemVeiculo.slice(0, 50),
    periodo: eventos.length
      ? {
        inicio: new Date(Math.min(...eventos.map((e) => e.data_hora.getTime()))),
        fim: new Date(Math.max(...eventos.map((e) => e.data_hora.getTime()))),
      }
      : null,
    importados: 0,
    duplicados_ignorados: 0,
    amostra: eventos.slice(0, 20).map(({ chave_unica, ...e }) => e),
  };
  if (!sim(opcoes.confirmar)) return res.status(200).json(resultado);

  const prazo = prazoPadrao();
  const registros = eventos.map((e) => ({
    ...e,
    // Dentro da tolerância não há conduta a tratar: nasce sem prazo.
    prazo_tratativa: e.severidade === 'NORMAL' ? null : prazo,
  }));
  let importados = 0;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE_INSERT) {
    const lote = registros.slice(i, i + TAMANHO_LOTE_INSERT);
    const { count } = await comRetry(
      () => prisma.eventoTelemetria.createMany({ data: lote, skipDuplicates: true }),
      'importar',
    );
    importados += count;
  }

  const corrigidos = await reconciliarFadiga(registros);

  await registrarLogAtividade(req, {
    acao: 'IMPORTAR_TELEMETRIA',
    modulo: MODULO_AUDITORIA,
    detalhes: { arquivo: req.file.originalname, total_eventos: registros.length, importados, corrigidos },
  }).catch(() => {});

  return res.status(200).json({
    ...resultado,
    confirmado: true,
    importados,
    corrigidos,
    duplicados_ignorados: registros.length - importados,
  });
});

// ============================================================================
// 5. CADASTRO MANUAL, TRATATIVA E EXCLUSÃO
// ============================================================================

function numeroOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) throw erroHttp(400, `O campo "${campo}" deve ser numerico.`);
  return n;
}

function textoOpcional(valor, max) {
  if (valor === undefined || valor === null) return null;
  const t = String(valor).trim();
  return t ? t.slice(0, max) : null;
}

export const criarEventoTelemetria = asyncHandler(async (req, res) => {
  const dados = req.body || {};
  const tagPlaca = textoOpcional(dados.tag_placa, 60);
  if (!tagPlaca) throw erroHttp(400, 'Informe a TAG ou placa do veiculo ("tag_placa").');
  if (!LISTA_EVENTOS.includes(dados.evento)) throw erroHttp(400, `Evento invalido. Aceitos: ${LISTA_EVENTOS.join(', ')}.`);
  const dataHora = new Date(dados.data_hora);
  if (!dados.data_hora || Number.isNaN(dataHora.getTime())) {
    throw erroHttp(400, 'Informe "data_hora" em ISO 8601 (ex.: 2026-11-03T08:15:00-03:00).');
  }
  if (dataHora.getTime() > Date.now() + 5 * 60 * 1000) throw erroHttp(400, 'A data do evento nao pode estar no futuro.');

  const valor = numeroOpcional(dados.valor, 'valor');
  const limite = numeroOpcional(dados.limite, 'limite');
  const avaliacao = regras.avaliarEvento(dados.evento, valor, limite);
  let { severidade } = avaliacao;
  if (dados.severidade) {
    severidade = String(dados.severidade).toUpperCase();
    if (!SEVERIDADES.includes(severidade)) throw erroHttp(400, `Severidade invalida. Aceitas: ${SEVERIDADES.join(', ')}.`);
  }
  const veiculo = (await carregarVeiculosPorPlaca()).get(chavePlaca(tagPlaca));
  const original = `${dados.evento} (lancamento manual)`;

  const evento = await comRetry(() => prisma.eventoTelemetria.create({
    data: {
      tag_placa: tagPlaca,
      tag: veiculo?.tag ?? textoOpcional(dados.tag, 50),
      motorista: textoOpcional(dados.motorista, 255),
      data_hora: dataHora,
      evento: dados.evento,
      valor,
      limite,
      localizacao: textoOpcional(dados.localizacao, 500),
      severidade,
      classificacao: severidade === 'NORMAL' ? null : avaliacao.classificacao,
      percentual_excesso: avaliacao.percentual_excesso,
      evento_original: original,
      origem: 'MANUAL',
      chave_unica: chaveUnica(tagPlaca, dataHora, original),
      observacao_tratativa: textoOpcional(dados.observacao, 5000),
      prazo_tratativa: severidade === 'NORMAL' ? null : prazoPadrao(),
    },
  }), 'criar');

  await registrarLogAtividade(req, {
    acao: 'CRIAR_EVENTO_TELEMETRIA',
    modulo: MODULO_AUDITORIA,
    detalhes: { id: evento.id, tag_placa: evento.tag_placa, evento: evento.evento },
  }).catch(() => {});
  return res.status(201).json(evento);
});

/**
 * TRATADO exige a medida aplicada; DESCARTADO exige o motivo (falso positivo, uso
 * como benefício comprovado — item 6.6). PENDENTE reabre.
 */
export const registrarTratativaTelemetria = asyncHandler(async (req, res) => {
  const id = idValido(req.params.id);
  const atual = await comRetry(() => prisma.eventoTelemetria.findUnique({ where: { id } }), 'obter');
  if (!atual) return res.status(404).json({ error: 'Nao encontrado', message: 'Evento de telemetria nao encontrado.' });

  const dados = req.body || {};
  const status = String(dados.status_tratativa || '').toUpperCase();
  if (!STATUS_TRATATIVA.includes(status)) throw erroHttp(400, `Informe "status_tratativa": ${STATUS_TRATATIVA.join(', ')}.`);
  const medida = textoOpcional(dados.medida_aplicada, 2000);
  const observacao = textoOpcional(dados.observacao, 5000);
  if (status === 'TRATADO' && !medida) throw erroHttp(400, 'Informe a medida aplicada ("medida_aplicada") para concluir a tratativa.');
  if (status === 'DESCARTADO' && !observacao) throw erroHttp(400, 'Informe o motivo do descarte em "observacao".');

  const reabrir = status === 'PENDENTE';
  const evento = await comRetry(() => prisma.eventoTelemetria.update({
    where: { id },
    data: {
      status_tratativa: status,
      medida_aplicada: reabrir ? null : medida,
      observacao_tratativa: observacao ?? (reabrir ? atual.observacao_tratativa : null),
      tratado_por: reabrir ? null : (req.atuante?.nome ?? null),
      tratado_em: reabrir ? null : new Date(),
    },
  }), 'tratativa');

  await registrarLogAtividade(req, {
    acao: 'TRATATIVA_TELEMETRIA',
    modulo: MODULO_AUDITORIA,
    detalhes: { id, status },
  }).catch(() => {});
  return res.status(200).json(evento);
});

export const excluirEventoTelemetria = asyncHandler(async (req, res) => {
  const id = idValido(req.params.id);
  const { count } = await comRetry(() => prisma.eventoTelemetria.deleteMany({ where: { id } }), 'excluir');
  if (!count) return res.status(404).json({ error: 'Nao encontrado', message: 'Evento de telemetria nao encontrado.' });
  await registrarLogAtividade(req, { acao: 'EXCLUIR_EVENTO_TELEMETRIA', modulo: MODULO_AUDITORIA, detalhes: { id } }).catch(() => {});
  return res.status(200).json({ sucesso: true, message: 'Evento excluido com sucesso.' });
});

export const excluirEventosTelemetriaLote = asyncHandler(async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'IDs invalidos', message: 'Envie um array "ids" com ao menos um ID para exclusao em lote.' });
  }
  if (ids.length > 500) throw erroHttp(400, 'Exclua no maximo 500 eventos por vez.');
  const idsValidos = [...new Set(ids.map(idValido))];
  const { count } = await comRetry(
    () => prisma.eventoTelemetria.deleteMany({ where: { id: { in: idsValidos } } }),
    'excluirLote',
  );
  await registrarLogAtividade(req, {
    acao: 'EXCLUIR_EVENTOS_TELEMETRIA_LOTE',
    modulo: MODULO_AUDITORIA,
    detalhes: { total_solicitado: idsValidos.length, total_excluido: count },
  }).catch(() => {});
  return res.status(200).json({
    sucesso: true,
    total_excluido: count,
    mensagem: `${count} ${count === 1 ? 'evento excluido' : 'eventos excluidos'} com sucesso.`,
  });
});

// ============================================================================
// 6. SEMANAS COM REGISTRO (filtro da tela)
// ============================================================================

/**
 * GET /api/telemetria/semanas — semanas do ano (ISO, -03:00) que têm eventos, da mais
 * recente para a mais antiga, com o total e a quebra por tipo. A tela usa as duas
 * mais recentes como seleção padrão.
 */
export const listarSemanasTelemetria = asyncHandler(async (_req, res) => {
  const eventos = await comRetry(() => prisma.eventoTelemetria.findMany({
    select: { data_hora: true, evento: true, valor: true },
    take: 200000,
  }), 'semanas');
  const semanas = new Map();
  for (const e of eventos) {
    const { ano, semana, chave } = semanaISO(e.data_hora);
    const s = semanas.get(chave) || { chave, ano, semana, total: 0, velocidade: 0, fadiga: 0, outros: 0 };
    s.total += 1;
    if (e.evento === EVENTOS.VELOCIDADE) s.velocidade += 1;
    else if (e.evento === EVENTOS.FADIGA) s.fadiga += 1;
    else if (e.evento !== EVENTOS.FADIGA_SEM_PARADA) s.outros += 1;
    semanas.set(chave, s);
  }
  const lista = [...semanas.values()]
    .map((s) => {
      const intervalo = lerSemanas(s.chave).intervalos[0];
      return { ...s, inicio: intervalo.inicio, fim: new Date(intervalo.fim.getTime() - 1) };
    })
    .sort((a, b) => b.chave.localeCompare(a.chave));
  return res.status(200).json({ semanas: lista, padrao: lista.slice(0, 2).map((s) => s.chave) });
});

// ============================================================================
// 7. TRAJETO, PLACAS SEM CADASTRO E EXCLUSÃO POR PLACA
// ============================================================================

const LIMITE_TRAJETO = 20000;
const CAMPOS_TRAJETO = {
  id: true, tag_placa: true, tag: true, motorista: true, data_hora: true, evento: true, valor: true, limite: true,
  severidade: true, latitude: true, longitude: true, localizacao: true, link_mapa: true, cerca: true,
};

async function carregarFrota() {
  const veiculos = await comRetry(() => prisma.mobDesmob.findMany({
    select: { tag: true, placa: true, status: true, deletado_em: true },
  }), 'frota-cadastro');
  return indexarFrota(veiculos);
}

/**
 * Valores exatos de `tag_placa` gravados para uma placa normalizada. A busca por trecho
 * só reduz os candidatos; a comparação final é pela placa normalizada (sem hífen,
 * espaços e caixa), então "QVN4G02 CT-251" e "qvn-4g02" casam com "QVN4G02".
 */
async function grafiasDaPlaca(chave, rotulo) {
  if (!chave) return [];
  const grupos = await comRetry(() => prisma.eventoTelemetria.groupBy({
    by: ['tag_placa'],
    where: { tag_placa: { contains: trechoBuscaPlaca(chave), mode: 'insensitive' } },
    _count: { _all: true },
  }), rotulo);
  return grupos.map((g) => g.tag_placa).filter((tp) => normalizarPlaca(tp) === chave);
}

/**
 * GET /api/telemetria/trajeto?veiculo=&dataInicio=AAAA-MM-DD&dataFim=AAAA-MM-DD&horaInicio=HH:mm&horaFim=HH:mm
 * Eventos do período, só dentro da janela de horário de cada dia (-03:00), em ordem de data_hora.
 * Com veículo, a consulta usa os índices de `tag` e `tag_placa` (valores exatos) em vez de busca textual.
 */
export const trajetoTelemetria = asyncHandler(async (req, res) => {
  const filtro = lerFiltroTrajeto(req.query);
  const where = filtroDataHoraTrajeto(filtro);
  let veiculo = null;

  if (filtro.veiculo) {
    const chave = normalizarPlaca(filtro.veiculo);
    const frota = await carregarFrota();
    const cadastro = frota.get(chave) || null;
    const placa = cadastro ? normalizarPlaca(cadastro.placa) : chave;
    const grafias = await grafiasDaPlaca(placa, 'trajeto-grafias');
    const vinculo = [];
    if (cadastro?.tag) vinculo.push({ tag: cadastro.tag });
    if (grafias.length) vinculo.push({ tag_placa: { in: grafias } });
    veiculo = {
      consulta: filtro.veiculo,
      placa: cadastro?.placa ?? placa,
      tag: cadastro?.tag ?? null,
      status_mobilizacao: statusMobilizacao(cadastro),
    };
    if (!vinculo.length) {
      return res.status(200).json({ veiculo, filtro: semJanelas(filtro), total: 0, truncado: false, pontos: [] });
    }
    where.AND = [...(where.AND || []), vinculo.length === 1 ? vinculo[0] : { OR: vinculo }];
  }

  const eventos = await comRetry(() => prisma.eventoTelemetria.findMany({
    where,
    select: CAMPOS_TRAJETO,
    orderBy: [{ data_hora: 'asc' }, { id: 'asc' }],
    take: LIMITE_TRAJETO + 1,
  }), 'trajeto');
  const truncado = eventos.length > LIMITE_TRAJETO;
  const pontos = truncado ? eventos.slice(0, LIMITE_TRAJETO) : eventos;
  return res.status(200).json({ veiculo, filtro: semJanelas(filtro), total: pontos.length, truncado, pontos });
});

function semJanelas({ janelas, diaInteiro, ...resto }) {
  return resto;
}

/**
 * GET /api/telemetria/placas-nao-cadastradas — placas da telemetria sem nenhum vínculo
 * com a frota (mobilizados, desmobilizados e lixeira contam como cadastrados).
 */
export const placasNaoCadastradas = asyncHandler(async (_req, res) => {
  const [grupos, frota] = await Promise.all([
    comRetry(() => prisma.eventoTelemetria.groupBy({
      by: ['tag_placa', 'tag'],
      _count: { _all: true },
      _min: { data_hora: true },
      _max: { data_hora: true },
    }), 'placas-sem-cadastro'),
    carregarFrota(),
  ]);
  const placas = placasSemCadastro(grupos, frota);
  return res.status(200).json({ total: placas.length, placas });
});

/**
 * DELETE /api/telemetria/por-placa/:placa — remove todos os eventos da placa
 * (comparação sem caixa, hífen ou espaços). Perfis: Master, Gestão e Transporte.
 */
export const excluirEventosPorPlaca = asyncHandler(async (req, res) => {
  const original = String(req.params.placa || '').trim();
  const chave = normalizarPlaca(original);
  if (!chave || chave.length < 3 || chave.length > 20) throw erroHttp(400, 'Informe uma placa valida.');
  const grafias = await grafiasDaPlaca(chave, 'excluir-placa-grafias');
  if (!grafias.length) {
    return res.status(404).json({ error: 'Nao encontrado', message: `Nenhum evento de telemetria para a placa ${chave}.`, total_excluido: 0 });
  }
  const { count } = await comRetry(
    () => prisma.eventoTelemetria.deleteMany({ where: { tag_placa: { in: grafias } } }),
    'excluir-placa',
  );
  await registrarLogAtividade(req, {
    acao: 'EXCLUIR_EVENTOS_TELEMETRIA_PLACA',
    modulo: MODULO_AUDITORIA,
    detalhes: { placa: chave, informada: original, grafias, total_excluido: count },
  }).catch(() => {});
  return res.status(200).json({
    sucesso: true,
    placa: chave,
    total_excluido: count,
    mensagem: `${count} ${count === 1 ? 'evento excluido' : 'eventos excluidos'} da placa ${chave}.`,
  });
});
