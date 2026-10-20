// ============================================================================
// Motor de calculo do Dashboard de Eficiencia de Transporte.
//
// Regra de valoracao da Parte Diaria (campo `status_operacional`):
//   - "Operacao" / "Parte Diaria Feita" / "Concluido" .... valor 1 (sucesso);
//   - "Manutencao Corretiva" / "Indisponibilidade" /
//     "Interdicao" ...................................... valor 0 (desvio);
//   - "Manutencao Preventiva" ............................ parada programada:
//        ISENTA do denominador da eficiencia; conta apenas como total;
//   - "Nao Operado" / "Sem Operacao" (folga / sem demanda): categoria neutra,
//        ISENTA do denominador e retirada das pendencias;
//   - "Pendente" explicito ou status nulo ................ conta como PENDENTE;
//   - Dia util (seg-sab) sem lancamento, dentro da janela de mobilizacao e
//     sem descarte manual: conta como PENDENTE.
//
//   O casamento do status e tolerante (comparacao sem acentos, caixa baixa e
//   por conteudo), aceitando tanto os valores gravados pelo app quanto os
//   textos da planilha de historico revisada.
//
//   Eficiencia = Operacao / (Operacao + Desvios)
//
// GET /api/eficiencia?dataInicio=&dataFim=&tag=&modelo=&contrato=&situacao=
//   situacao: MOB (padrao — frota mobilizada) | DESMOB | TODOS.
//   Periodo padrao: inicio do mes (hoje - 5 meses) ate hoje; maximo 366 dias.
//
// Resposta: indicadores globais, eficiencia por TAG e por MODELO (crescente),
// evolucao mensal, calendario de paradas por dia e opcoes de filtro.
//
// GET /api/eficiencia/matriz?mes=YYYY-MM&tag=&modelo=&contrato=&situacao=
//   Matriz calendario do mes: status dia a dia por veiculo (celulas da tela
//   "Matriz Calendario"). Sabado/domingo e feriados nacionais ficam fora da
//   contagem de pendencias; pendencia = dia util (seg-sex) sem lancamento,
//   dentro da janela de mobilizacao e sem descarte manual. Celula com mais de
//   um lancamento no dia usa o pior caso (desvio > preventiva > operacao >
//   nao operado).
//   Escopo de veiculos: TODA TAG com apontamento no mes aparece (inclusive
//   desmobilizado/inativo — historico preservado); sem apontamento, o veiculo
//   entra quando respeita o filtro MOB/DESMOB (padrao TODOS) e a janela de
//   mobilizacao cruza o mes. Cada veiculo devolve data_mob/data_desmob para o
//   front bloquear as celulas fora da janela.
//
// POST /api/eficiencia/importar-historico  (multipart, campo: arquivo .xlsx)
//   Importa em lote o historico de Partes Diarias para o BI de Eficiencia.
//   Mesmas regras de negocio do script CLI scripts/importarHistoricoLocal.js.
// ============================================================================
import XLSX from 'xlsx';
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { comRetryConexao } from '../utils/retryBanco.js';

const STATUS_OPERACAO = 'Operação';
const STATUS_CORRETIVA = 'Manutenção Corretiva';
const STATUS_PREVENTIVA = 'Manutenção Preventiva';
const STATUS_INDISPONIBILIDADE = 'Indisponibilidade';
const STATUS_INTERDICAO = 'Interdição';
const STATUS_NAO_OPERADO = 'Não Operado';

// Secoes do dashboard (chaves usadas nos acumuladores e na resposta).
const SECOES = ['operacao', 'corretiva', 'preventiva', 'interdicao', 'indisponibilidade', 'nao_operado'];
// Secoes de manutencao listadas no calendario de paradas (por veiculo).
const SECOES_CALENDARIO = ['corretiva', 'preventiva', 'interdicao', 'indisponibilidade'];

// Prioridade da celula da Matriz Calendario quando o dia tem mais de um
// lancamento para a mesma TAG: o pior caso prevalece (mesma regra da
// importacao de historico). Pendentes nao sobrescrevem lancamento real e
// "nao operado" e neutro (so aparece quando nao ha status operacional no dia).
const PRIORIDADE_MATRIZ = {
  corretiva: 3,
  indisponibilidade: 3,
  interdicao: 3,
  preventiva: 2,
  operacao: 1,
  nao_operado: 0,
};

const PERIODO_MAX_DIAS = 366;
const MESES_PADRAO_JANELA = 6; // periodo padrao: mes atual + 5 anteriores

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Datas de calendario no fuso da operacao (UTC-3), sem deslocamento de dia.
function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function somarDiasISO(iso, delta) {
  const [ano, mes, dia] = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + delta));
  return d.toISOString().slice(0, 10);
}

function isoParaData(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoDeData(valor) {
  return valor instanceof Date
    ? valor.toISOString().slice(0, 10)
    : String(valor || '').slice(0, 10);
}

function eDomingo(iso) {
  const [ano, mes, dia] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay() === 0;
}

function eISOValida(iso) {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [ano, mes, dia] = s.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

// Domingo de Pascoa (algoritmo de Meeus/Jones/Butcher, calendario gregoriano).
function domingoDePascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Feriados nacionais brasileiros do ano (fixos + moveis), em ISO.
// Usados pela Matriz Calendario: feriado nao gera pendencia.
function feriadosNacionais(ano) {
  const pascoa = domingoDePascoa(ano);
  return new Set([
    `${ano}-01-01`, // Confraternizacao Universal
    `${ano}-04-21`, // Tiradentes
    `${ano}-05-01`, // Dia do Trabalho
    `${ano}-09-07`, // Independencia
    `${ano}-10-12`, // Nossa Senhora Aparecida
    `${ano}-11-02`, // Finados
    `${ano}-11-15`, // Proclamacao da Republica
    `${ano}-11-20`, // Consciencia Negra
    `${ano}-12-25`, // Natal
    somarDiasISO(pascoa, -48), // Carnaval (segunda)
    somarDiasISO(pascoa, -47), // Carnaval (terca)
    somarDiasISO(pascoa, -2),  // Sexta-feira Santa
    somarDiasISO(pascoa, 60),  // Corpus Christi
  ]);
}

function normalizar(v) {
  return String(v || '').trim();
}

// Normaliza o status para comparacao tolerante: sem acentos, caixa baixa e
// sem espacos sobrando (aceita as variacoes gravadas pela importacao).
function normalizarStatus(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

// Categoria neutra: folga / sem demanda. Nao entra no denominador da
// eficiencia e, por ter lancamento, tambem nao gera pendencia.
function ehStatusNaoOperado(valorNormalizado) {
  return valorNormalizado.includes('nao operado')
    || valorNormalizado.includes('nao operacao')
    || valorNormalizado.includes('sem operacao')
    || valorNormalizado.includes('sem demanda')
    || valorNormalizado.includes('folga');
}

// Mapeia o status_operacional da Parte Diaria para a secao do dashboard.
// Desvios sao verificados antes de "parte diaria feita", pois o sufixo entre
// parenteses define a secao. PENDENTE somente quando o status e explicitamente
// "pendente" (ou nulo) — nunca para os status importados da planilha.
function secaoDoStatus(status) {
  const valor = normalizarStatus(status);
  if (!valor || valor === 'pendente') return 'pendentes';
  if (valor.includes('corretiva')) return 'corretiva';
  if (valor.includes('preventiva')) return 'preventiva';
  if (valor.includes('interdicao')) return 'interdicao';
  if (valor.includes('indisponibilidade')) return 'indisponibilidade';
  if (ehStatusNaoOperado(valor)) return 'nao_operado';
  if (valor.includes('operacao')) return 'operacao';
  if (valor.includes('parte diaria feita')) return 'operacao';
  if (valor.includes('concluid')) return 'operacao';
  return null; // status fora do dominio: ignora
}

function zerado() {
  return { operacao: 0, corretiva: 0, preventiva: 0, interdicao: 0, indisponibilidade: 0, nao_operado: 0, pendentes: 0 };
}

function desvioDe(stats) {
  return stats.corretiva + stats.indisponibilidade + stats.interdicao;
}

// Eficiencia = operacao / (operacao + desvios). Sem denominador -> null.
function eficienciaDe(stats) {
  const base = stats.operacao + desvioDe(stats);
  return base > 0 ? stats.operacao / base : null;
}

function comIndicadores(stats) {
  const desvio = desvioDe(stats);
  return {
    ...stats,
    desvio,
    total_registrado: stats.operacao + stats.corretiva + stats.preventiva + stats.interdicao + stats.indisponibilidade + stats.nao_operado,
    eficiencia: eficienciaDe(stats),
  };
}

// Mes 'YYYY-MM' -> rotulo pt-BR ('Mai' ou 'Mai/26' quando o periodo cruza anos).
function rotuloMes(mesISO, incluirAno) {
  const [ano, mes] = String(mesISO).split('-').map(Number);
  const abreviacao = MESES_ABREV[(mes || 1) - 1] || mesISO;
  const rotulo = abreviacao.charAt(0).toUpperCase() + abreviacao.slice(1);
  return incluirAno ? `${rotulo}/${String(ano).slice(2)}` : rotulo;
}

// Resolve o periodo (dataInicio/dataFim). Retorna { erro } se invalido.
function resolverPeriodo(query) {
  const hoje = hojeISO();
  let inicio = String(query.dataInicio || '').trim();
  let fim = String(query.dataFim || '').trim();
  if (inicio && !eISOValida(inicio)) {
    return { erro: 'Data invalida em `dataInicio`. Use YYYY-MM-DD.' };
  }
  if (fim && !eISOValida(fim)) {
    return { erro: 'Data invalida em `dataFim`. Use YYYY-MM-DD.' };
  }
  if (!inicio && !fim) {
    // Padrao: janela de 6 meses (mes atual + 5 anteriores) ate hoje.
    const [ano, mes] = hoje.split('-').map(Number);
    const ref = new Date(Date.UTC(ano, mes - 1 - (MESES_PADRAO_JANELA - 1), 1));
    inicio = ref.toISOString().slice(0, 10);
    fim = hoje;
  } else {
    if (!inicio) inicio = somarDiasISO(fim, -(PERIODO_MAX_DIAS - 1));
    if (!fim) fim = hoje;
  }
  if (inicio > fim) [inicio, fim] = [fim, inicio];
  if (somarDiasISO(inicio, PERIODO_MAX_DIAS - 1) < fim) {
    return { erro: `Periodo maximo de ${PERIODO_MAX_DIAS} dias. Reduza o intervalo.` };
  }
  return { inicio, fim };
}

export const obterEficiencia = asyncHandler(async (req, res) => {
  const periodo = resolverPeriodo(req.query);
  if (periodo.erro) {
    return res.status(400).json({ error: 'Parametros invalidos', message: periodo.erro });
  }

  const filtroTag = normalizar(req.query.tag);
  const filtroModelo = normalizar(req.query.modelo);
  const filtroContrato = normalizar(req.query.contrato);
  const situacao = (normalizar(req.query.situacao) || 'MOB').toUpperCase(); // MOB | DESMOB | TODOS

  const inicioData = isoParaData(periodo.inicio);
  const fimData = isoParaData(periodo.fim);

  // ---------------------------------------------------------------------------
  // Passo A: universo de veiculos + opcoes dos filtros (tabela completa).
  // ---------------------------------------------------------------------------
  const veiculosTodos = await comRetryConexao(() => prisma.mobDesmob.findMany({
    select: { tag: true, placa: true, modelo: true, contrato: true, status: true, data_mob: true, data_desmob: true },
    orderBy: { tag: 'asc' },
  }), 3, 700, 'eficiencia');

  const opcoes = {
    tags: veiculosTodos.map((v) => ({ tag: v.tag, placa: v.placa, modelo: v.modelo || null, contrato: v.contrato || null })),
    modelos: [...new Set(veiculosTodos.map((v) => normalizar(v.modelo)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    contratos: [...new Set(veiculosTodos.map((v) => normalizar(v.contrato)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };

  const veiculos = veiculosTodos.filter((v) => {
    if (filtroTag && normalizar(v.tag) !== filtroTag) return false;
    if (filtroModelo && normalizar(v.modelo) !== filtroModelo) return false;
    if (filtroContrato && normalizar(v.contrato) !== filtroContrato) return false;
    if (situacao === 'MOB' && v.status === 'Desmobilizado') return false;
    if (situacao === 'DESMOB' && v.status !== 'Desmobilizado') return false;
    return true;
  });
  const tags = veiculos.map((v) => v.tag);

  // ---------------------------------------------------------------------------
  // Passo B: partes diarias do periodo (universo) + descartes de pendencia.
  // ---------------------------------------------------------------------------
  const [partes, ignoradas] = await Promise.all([
    tags.length
      ? comRetryConexao(() => prisma.parteDiaria.findMany({
        where: { tag: { in: tags }, data: { gte: inicioData, lte: fimData } },
        select: {
          tag: true,
          data: true,
          status_operacional: true,
          operador: true,
          funcionario: true,
          observacao_rapida: true,
          // Motivo operacional das paradas: o formulario completo grava o
          // motivo da parada como ocorrencia (descricao).
          ocorrencias: {
            select: { descricao: true },
            orderBy: { created_at: 'desc' },
            take: 3,
          },
        },
      }), 3, 700, 'eficiencia')
      : Promise.resolve([]),
    comRetryConexao(() => prisma.pendenciaParteDiariaIgnorada.findMany({
      where: { data: { gte: inicioData, lte: fimData } },
      select: { tag: true, data: true },
    }), 3, 700, 'eficiencia'),
  ]);

  const descartes = new Set(ignoradas.map((i) => `${normalizar(i.tag)}|${isoDeData(i.data)}`));

  // Grade de dias uteis (seg-sab) do periodo — base das pendencias.
  const diasGrade = [];
  for (let d = periodo.inicio; d <= periodo.fim; d = somarDiasISO(d, 1)) {
    if (!eDomingo(d)) diasGrade.push(d);
  }

  // ---------------------------------------------------------------------------
  // Passo C: acumuladores (global, por TAG, por mes, por dia p/ calendario).
  // ---------------------------------------------------------------------------
  const global = zerado();
  const porTag = new Map(); // tag -> stats + cadastro
  const porMes = new Map(); // 'YYYY-MM' -> stats
  const porDia = new Map(); // ISO -> contagens + veiculos em manutencao
  const presentes = new Map(); // tag -> Set(dia) dos lancamentos
  // Detalhes operacionais das interdições por TAG (tooltip do painel superior).
  const interdicoesPorTag = new Map(); // tag -> { datas:Set, motivos:Set }

  for (const v of veiculos) {
    porTag.set(normalizar(v.tag), {
      tag: v.tag,
      placa: v.placa,
      modelo: normalizar(v.modelo) || 'Sem modelo',
      contrato: normalizar(v.contrato) || null,
      status: v.status || null,
      ...zerado(),
    });
  }

  for (const p of partes) {
    const tagKey = normalizar(p.tag);
    const stats = porTag.get(tagKey);
    if (!stats) continue; // fora do universo filtrado
    const dia = isoDeData(p.data);
    if (!presentes.has(tagKey)) presentes.set(tagKey, new Set());
    presentes.get(tagKey).add(dia);

    const secao = secaoDoStatus(p.status_operacional);
    if (!secao) continue;
    stats[secao] += 1;
    global[secao] += 1;

    if (secao === 'interdicao') {
      if (!interdicoesPorTag.has(tagKey)) {
        interdicoesPorTag.set(tagKey, { datas: new Set(), motivos: new Set() });
      }
      const detalhe = interdicoesPorTag.get(tagKey);
      detalhe.datas.add(dia);
      const motivoOcorrencia = normalizar(
        (p.ocorrencias || []).map((o) => o?.descricao).find((d) => normalizar(d)),
      );
      const motivo = normalizar(p.observacao_rapida) || motivoOcorrencia;
      if (motivo) detalhe.motivos.add(motivo);
    }

    const mes = dia.slice(0, 7);
    if (!porMes.has(mes)) porMes.set(mes, zerado());
    porMes.get(mes)[secao] += 1;

    if (!porDia.has(dia)) {
      porDia.set(dia, { data: dia, ...zerado(), veiculos: { corretiva: [], preventiva: [], interdicao: [], indisponibilidade: [] } });
    }
    const registro = porDia.get(dia);
    registro[secao] += 1;
    if (SECOES_CALENDARIO.includes(secao)) {
      registro.veiculos[secao].push({ tag: p.tag, placa: stats.placa, modelo: stats.modelo });
    }
  }

  // Passo D: pendencias (veiculo x dia util sem lancamento e sem descarte).
  for (const v of veiculos) {
    const tagKey = normalizar(v.tag);
    const stats = porTag.get(tagKey);
    const presentesTag = presentes.get(tagKey) || new Set();
    const mobISO = v.data_mob ? isoDeData(v.data_mob) : null;
    const desmobISO = v.data_desmob ? isoDeData(v.data_desmob) : null;
    for (const dia of diasGrade) {
      if (mobISO && mobISO > dia) continue; // ainda nao mobilizado
      if (desmobISO && desmobISO < dia) continue; // ja desmobilizado
      if (presentesTag.has(dia)) continue;
      if (descartes.has(`${tagKey}|${dia}`)) continue;
      stats.pendentes += 1;
      global.pendentes += 1;
      const mes = dia.slice(0, 7);
      if (!porMes.has(mes)) porMes.set(mes, zerado());
      porMes.get(mes).pendentes += 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Passo E: montagem da resposta.
  // ---------------------------------------------------------------------------
  const totais = {
    ...global,
    desvio: desvioDe(global),
  };
  const baseEficiencia = totais.operacao + totais.desvio;
  const totalObservado = baseEficiencia + totais.preventiva + totais.nao_operado + totais.pendentes;
  const pct = (n) => (totalObservado > 0 ? n / totalObservado : null);

  const porTagLista = [...porTag.values()]
    .map((linha) => {
      const indicadores = comIndicadores(linha);
      const detalhe = interdicoesPorTag.get(normalizar(linha.tag));
      const datas = detalhe ? [...detalhe.datas].sort() : [];
      const motivos = detalhe ? [...detalhe.motivos] : [];
      const baseValidada = indicadores.operacao + indicadores.desvio;
      return {
        ...indicadores,
        interdicoes: {
          dias: datas.length,
          datas,
          motivo: motivos[0] || null,
          motivos,
          dias_uteis_periodo: diasGrade.length,
          percentual_dias_uteis: diasGrade.length ? datas.length / diasGrade.length : null,
          percentual_dias_validos: baseValidada > 0 ? datas.length / baseValidada : null,
        },
      };
    })
    .sort((a, b) => {
      if (a.eficiencia === null && b.eficiencia === null) return a.tag.localeCompare(b.tag, 'pt-BR');
      if (a.eficiencia === null) return 1;
      if (b.eficiencia === null) return -1;
      if (a.eficiencia !== b.eficiencia) return a.eficiencia - b.eficiencia;
      return a.tag.localeCompare(b.tag, 'pt-BR');
    });

  // Eficiencia por modelo de veiculo (soma dos veiculos do mesmo modelo).
  const modeloAcumulado = new Map();
  for (const linha of porTagLista) {
    if (!modeloAcumulado.has(linha.modelo)) {
      modeloAcumulado.set(linha.modelo, {
        modelo: linha.modelo,
        veiculos: 0,
        contrato_dominante: linha.contrato || null,
        ...zerado(),
      });
    }
    const alvo = modeloAcumulado.get(linha.modelo);
    alvo.veiculos += 1;
    for (const chave of SECOES) alvo[chave] += linha[chave];
    alvo.pendentes += linha.pendentes;
  }
  const porModelo = [...modeloAcumulado.values()]
    .map(comIndicadores)
    .sort((a, b) => {
      if (a.eficiencia === null && b.eficiencia === null) return a.modelo.localeCompare(b.modelo, 'pt-BR');
      if (a.eficiencia === null) return 1;
      if (b.eficiencia === null) return -1;
      if (a.eficiencia !== b.eficiencia) return a.eficiencia - b.eficiencia;
      return a.modelo.localeCompare(b.modelo, 'pt-BR');
    });

  // Evolucao mensal: buckets continuos do inicio ao fim do periodo.
  const meses = [];
  let [anoCorr, mesCorr] = periodo.inicio.split('-').map(Number);
  const [anoFim, mesFim] = periodo.fim.split('-').map(Number);
  while (anoCorr < anoFim || (anoCorr === anoFim && mesCorr <= mesFim)) {
    meses.push(`${anoCorr}-${String(mesCorr).padStart(2, '0')}`);
    mesCorr += 1;
    if (mesCorr > 12) { mesCorr = 1; anoCorr += 1; }
  }
  const cruzamAnos = new Set(meses.map((m) => m.slice(0, 4))).size > 1;
  const porMesLista = meses.map((mes) => {
    const stats = porMes.get(mes) || zerado();
    return { mes, rotulo: rotuloMes(mes, cruzamAnos), ...comIndicadores(stats) };
  });

  const calendario = [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data));

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    data: {
      periodo: { inicio: periodo.inicio, fim: periodo.fim, dias_uteis: diasGrade.length },
      filtros: {
        tag: filtroTag || null,
        modelo: filtroModelo || null,
        contrato: filtroContrato || null,
        situacao,
      },
      indicadores: {
        eficiencia: baseEficiencia > 0 ? totais.operacao / baseEficiencia : null,
        totais,
        percentuais: {
          operacao: pct(totais.operacao),
          corretiva: pct(totais.corretiva),
          preventiva: pct(totais.preventiva),
          interdicao: pct(totais.interdicao),
          indisponibilidade: pct(totais.indisponibilidade),
          nao_operado: pct(totais.nao_operado),
          pendentes: pct(totais.pendentes),
        },
        total_observado: totalObservado,
        veiculos: porTag.size,
      },
      por_tag: porTagLista,
      por_modelo: porModelo,
      por_mes: porMesLista,
      calendario,
      opcoes,
    },
  });
});

// ============================================================================
// GET /api/eficiencia/matriz?mes=YYYY-MM&tag=&modelo=&contrato=&situacao=
// Matriz Calendario — analise mensal detalhada por veiculo (secao inferior da
// tela de Gestao de Eficiencia).
//
// Celula (TAG, dia): secao do lancamento ('operacao', 'corretiva',
// 'preventiva', 'interdicao', 'indisponibilidade', 'nao_operado'), 'pendentes'
// (dia util seg-sex, sem feriado, dentro da janela de mobilizacao, sem
// lancamento e sem descarte manual) ou null (fim de semana, feriado, dia futuro
// ou fora da janela). Aderencia do veiculo/mes = Operacao / (Operacao + Desvios).
//
// Escopo: TODA TAG com apontamento no mes aparece, independentemente do
// status atual (MOB/DESMOB) ou de existir em MobDesmob. O filtro `situacao`
// restringe apenas veiculos SEM apontamento no mes; o front bloqueia os dias
// posteriores a data_desmob.
// ============================================================================
export const obterMatrizMensal = asyncHandler(async (req, res) => {
  const mes = normalizar(req.query.mes);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    return res.status(400).json({ error: 'Parametros invalidos', message: 'Informe `mes` no formato YYYY-MM.' });
  }
  if (mes > hojeISO().slice(0, 7)) {
    return res.status(400).json({ error: 'Parametros invalidos', message: 'O mes informado ainda nao comecou.' });
  }

  const filtroTag = normalizar(req.query.tag);
  const filtroModelo = normalizar(req.query.modelo);
  const filtroContrato = normalizar(req.query.contrato);
  // Padrao TODOS: historico completo (nao esconde desmobilizados que
  // trabalharam no mes). MOB/DESMOB restringem apenas veiculos SEM apontamento.
  const situacao = (normalizar(req.query.situacao) || 'TODOS').toUpperCase(); // MOB | DESMOB | TODOS

  const [ano, mesNum] = mes.split('-').map(Number);
  const diasNoMes = new Date(Date.UTC(ano, mesNum, 0)).getUTCDate();
  const inicio = `${mes}-01`;
  const fim = `${mes}-${String(diasNoMes).padStart(2, '0')}`;
  const hoje = hojeISO();
  const feriados = feriadosNacionais(ano);

  const dias = [];
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const iso = `${mes}-${String(dia).padStart(2, '0')}`;
    const diaSemana = new Date(Date.UTC(ano, mesNum - 1, dia)).getUTCDay();
    dias.push({
      dia,
      iso,
      fim_semana: diaSemana === 0 || diaSemana === 6,
      feriado: feriados.has(iso),
      futuro: iso > hoje,
    });
  }

  const inicioData = isoParaData(inicio);
  const fimData = isoParaData(fim);

  const veiculosTodos = await comRetryConexao(() => prisma.mobDesmob.findMany({
    select: { tag: true, placa: true, modelo: true, contrato: true, status: true, data_mob: true, data_desmob: true },
    orderBy: { tag: 'asc' },
  }), 3, 700, 'eficiencia');

  // Universo por TAG/modelo/contrato (sem situacao): a matriz precisa dos
  // apontamentos do mes ANTES de decidir quais veiculos aparecem.
  const universo = veiculosTodos.filter((v) => {
    if (filtroTag && normalizar(v.tag) !== filtroTag) return false;
    if (filtroModelo && normalizar(v.modelo) !== filtroModelo) return false;
    if (filtroContrato && normalizar(v.contrato) !== filtroContrato) return false;
    return true;
  });
  const tagsUniverso = new Set(universo.map((v) => normalizar(v.tag)));
  const veiculosPorTag = new Map(veiculosTodos.map((v) => [normalizar(v.tag), v]));

  // Leitura ampla do mes: toda TAG com registro no banco precisa aparecer,
  // mesmo que nao esteja mais em MobDesmob (historico importado) ou que o
  // filtro MOB/DESMOB atual a esconderia. TAGs sem cadastro so entram quando
  // nao ha filtro de modelo/contrato (nao ha como classifica-las).
  const [partesBrutas, ignoradas] = await Promise.all([
    comRetryConexao(() => prisma.parteDiaria.findMany({
      where: {
        data: { gte: inicioData, lte: fimData },
        ...(filtroTag ? { tag: filtroTag } : {}),
      },
      select: { tag: true, data: true, status_operacional: true, observacao_rapida: true, updated_at: true },
    }), 3, 700, 'eficiencia'),
    comRetryConexao(() => prisma.pendenciaParteDiariaIgnorada.findMany({
      where: { data: { gte: inicioData, lte: fimData } },
      select: { tag: true, data: true },
    }), 3, 700, 'eficiencia'),
  ]);

  const partes = partesBrutas.filter((p) => {
    const tagKey = normalizar(p.tag);
    if (veiculosPorTag.has(tagKey)) return tagsUniverso.has(tagKey);
    return !filtroModelo && !filtroContrato;
  });
  const tagsComRegistro = new Map(); // tagKey -> tag original
  for (const p of partes) {
    const tagKey = normalizar(p.tag);
    if (!tagsComRegistro.has(tagKey)) tagsComRegistro.set(tagKey, p.tag);
  }

  const passaSituacao = (v) => {
    if (situacao === 'MOB') return v.status !== 'Desmobilizado';
    if (situacao === 'DESMOB') return v.status === 'Desmobilizado';
    return true; // TODOS
  };

  // Escopo da matriz: TAG com apontamento no mes SEMPRE aparece (inclusive
  // desmobilizada/inativa — historico preservado). Sem apontamento, entra
  // quando respeita o filtro MOB/DESMOB e a janela de mobilizacao cruza o mes
  // (necessario para exibir as pendencias do periodo).
  const veiculos = universo.filter((v) => {
    if (tagsComRegistro.has(normalizar(v.tag))) return true;
    if (!passaSituacao(v)) return false;
    const mobISO = v.data_mob ? isoDeData(v.data_mob) : null;
    const desmobISO = v.data_desmob ? isoDeData(v.data_desmob) : null;
    if (mobISO && mobISO > fim) return false; // ainda nao mobilizado no mes
    if (desmobISO && desmobISO < inicio) return false; // ja desmobilizado antes do mes
    return true;
  });

  // TAGs historicas sem cadastro em MobDesmob: cria uma linha sintetica para
  // nao perder apontamentos antigos (ex.: importacoes de outra base).
  for (const [tagKey, tagOriginal] of tagsComRegistro) {
    if (veiculosPorTag.has(tagKey)) continue;
    veiculos.push({
      tag: tagOriginal,
      placa: null,
      modelo: null,
      contrato: null,
      status: null,
      data_mob: null,
      data_desmob: null,
    });
  }

  const descartes = new Set(ignoradas.map((i) => `${normalizar(i.tag)}|${isoDeData(i.data)}`));

  // Pior caso por (TAG, dia); status fora do dominio / pendente explicito
  // equivale a "sem lancamento" (a celula cai na regra de pendencia).
  const lancamentos = new Map();
  // Observacao rapida mais recente por (TAG, dia) — exibida ao reabrir o modal.
  const observacoes = new Map();
  for (const p of partes) {
    const chave = `${normalizar(p.tag)}|${isoDeData(p.data)}`;
    const textoObs = normalizar(p.observacao_rapida);
    if (textoObs) {
      const ts = p.updated_at ? new Date(p.updated_at).getTime() : 0;
      const atualObs = observacoes.get(chave);
      if (!atualObs || ts >= atualObs.ts) observacoes.set(chave, { texto: textoObs, ts });
    }
    const secao = secaoDoStatus(p.status_operacional);
    if (!secao || secao === 'pendentes') continue;
    const prioridade = PRIORIDADE_MATRIZ[secao] ?? -1;
    const atual = lancamentos.get(chave);
    if (!atual || prioridade >= atual.prioridade) lancamentos.set(chave, { secao, prioridade });
  }

  const global = zerado();
  const linhas = veiculos.map((v) => {
    const tagKey = normalizar(v.tag);
    const mobISO = v.data_mob ? isoDeData(v.data_mob) : null;
    const desmobISO = v.data_desmob ? isoDeData(v.data_desmob) : null;
    const stats = zerado();
    const celulas = {};
    const celulasObservacao = {};
    for (const d of dias) {
      const chave = `${tagKey}|${d.iso}`;
      const lancamento = lancamentos.get(chave);
      if (lancamento) {
        celulas[d.dia] = lancamento.secao;
        stats[lancamento.secao] += 1;
        global[lancamento.secao] += 1;
      } else {
        const dentroJanela = (!mobISO || d.iso >= mobISO) && (!desmobISO || d.iso <= desmobISO);
        if (!d.fim_semana && !d.feriado && !d.futuro && dentroJanela && !descartes.has(chave)) {
          celulas[d.dia] = 'pendentes';
          stats.pendentes += 1;
          global.pendentes += 1;
        } else {
          celulas[d.dia] = null;
        }
      }
      const obs = observacoes.get(chave);
      if (obs) celulasObservacao[d.dia] = obs.texto;
    }
    return {
      tag: v.tag,
      placa: v.placa,
      modelo: normalizar(v.modelo) || 'Sem modelo',
      contrato: normalizar(v.contrato) || null,
      status: v.status || null,
      data_mob: v.data_mob ? isoDeData(v.data_mob) : null,
      data_desmob: v.data_desmob ? isoDeData(v.data_desmob) : null,
      dias: celulas,
      observacoes: celulasObservacao,
      ...comIndicadores(stats),
    };
  }).sort((a, b) => {
    if (a.eficiencia === null && b.eficiencia === null) return a.tag.localeCompare(b.tag, 'pt-BR');
    if (a.eficiencia === null) return 1;
    if (b.eficiencia === null) return -1;
    if (a.eficiencia !== b.eficiencia) return a.eficiencia - b.eficiencia;
    return a.tag.localeCompare(b.tag, 'pt-BR');
  });

  const resumo = {
    veiculos: linhas.length,
    dias_no_mes: diasNoMes,
    ...comIndicadores(global),
    dias_validos: global.operacao + desvioDe(global),
    meta: 0.95,
  };

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    data: {
      mes,
      ano,
      dias,
      feriados: [...feriados].filter((f) => f.startsWith(mes)),
      resumo,
      veiculos: linhas,
      filtros: {
        tag: filtroTag || null,
        modelo: filtroModelo || null,
        contrato: filtroContrato || null,
        situacao,
      },
    },
  });
});

// ============================================================================
// POST /api/eficiencia/importar-historico
// Recebe um arquivo .xlsx via multipart (campo: `arquivo`) e importa em lote
// o historico de Partes Diarias para o BI de Eficiencia.
//
// Regras de mapeamento (STATUS planilha -> status_operacional):
//   "Parte Diaria Feita" | "Operacao"            -> "Operacao"             (+1 denominador)
//   "Parte Diaria Feita (Manutencao Corretiva)"  -> "Manutencao Corretiva" (+1 denominador, valor 0)
//   "Parte Diaria Feita (Indisponibilidade)"     -> "Indisponibilidade"    (+1 denominador, valor 0)
//   "Parte Diaria Feita (Interdicao)"            -> "Interdicao"           (+1 denominador, valor 0)
//   "Parte Diaria Feita (Manutencao Preventiva)" -> "Manutencao Preventiva"(isento do denominador)
//   "Nao Operado" | "Sem Operacao"               -> "Nao Operado"            (isento do denominador)
//   Qualquer "Pendente"                          -> DESCARTADO
// ============================================================================

// STATUS da planilha -> status canonico do app. Classificacao tolerante
// (trim + sem acentos + caixa baixa + por conteudo), identica ao script CLI
// scripts/importarHistoricoLocal.js. Desvios antes de "parte diaria feita".
//   null = Pendente (descartar) | undefined = fora do dominio.
function mapearStatusBI(rawStatus) {
  const s = normalizarStatus(rawStatus);
  if (!s) return undefined;
  if (s.includes('pendente')) return null;
  if (s.includes('corretiva')) return STATUS_CORRETIVA;
  if (s.includes('preventiva')) return STATUS_PREVENTIVA;
  if (s.includes('interdicao')) return STATUS_INTERDICAO;
  if (s.includes('indisponibilidade')) return STATUS_INDISPONIBILIDADE;
  if (ehStatusNaoOperado(s)) return STATUS_NAO_OPERADO;
  if (s.includes('operacao') || s.includes('parte diaria feita') || s.includes('concluid')) return STATUS_OPERACAO;
  return undefined; // fora do dominio
}

function excelSerialParaDateBI(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return new Date(Math.round((valor - 25569) * 86400 * 1000));
  }
  const d = new Date(String(valor));
  return isNaN(d.getTime()) ? null : d;
}

async function garantirTagBI(tag, tagsCriadas) {
  if (tagsCriadas.has(tag)) return;
  const existe = await prisma.mobDesmob.findUnique({ where: { tag } });
  if (!existe) {
    const placaBase = `HIST-${tag}`.slice(0, 20);
    try {
      await prisma.mobDesmob.upsert({
        where:  { tag },
        update: {},
        create: { tag, placa: placaBase, status: 'Mobilizado', data_mob: new Date('2026-01-01T00:00:00.000Z') },
      });
    } catch (e) {
      if (e.code === 'P2002') {
        const placaAlt = `HIST-${tag}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`.slice(0, 20);
        await prisma.mobDesmob.upsert({
          where:  { tag },
          update: {},
          create: { tag, placa: placaAlt, status: 'Mobilizado', data_mob: new Date('2026-01-01T00:00:00.000Z') },
        });
      } else {
        throw e;
      }
    }
  }
  tagsCriadas.add(tag);
}

export const importarHistorico = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({
      error: 'Arquivo ausente',
      message: 'Envie um .xlsx no campo `arquivo` (multipart/form-data).',
    });
  }

  const wb = XLSX.read(req.file.buffer, { cellDates: true });
  const nomeAba = wb.SheetNames[0];
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: null });

  if (linhas.length < 2) {
    return res.status(422).json({ error: 'Planilha vazia ou sem dados apos o cabecalho.' });
  }

  const cabecalho = linhas[0].map((c) => normalizar(c).toUpperCase());

  function encontrarColuna(...nomes) {
    for (const nome of nomes) {
      const idx = cabecalho.findIndex((c) => c === nome.toUpperCase());
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const IDX_TAG    = encontrarColuna('TAG', 'MATRICULA/TAG', 'EQUIPAMENTO', 'VEICULO');
  const IDX_DATA   = encontrarColuna('DATA', 'DATE', 'DT');
  const IDX_STATUS = encontrarColuna('STATUS', 'TIPO', 'SITUACAO', 'STATUS/TIPO');

  if (IDX_TAG === -1 || IDX_DATA === -1 || IDX_STATUS === -1) {
    return res.status(422).json({
      error: 'Colunas nao encontradas',
      message: `Colunas lidas: ${cabecalho.join(' | ')}. Necessarias: TAG, DATA, STATUS.`,
    });
  }

  const dados = linhas.slice(1).filter((r) => r[IDX_TAG] != null && normalizar(r[IDX_TAG]) !== '');
  const resumo = {
    lidas: dados.length,
    processadas: 0,
    ignoradas_pendente: 0,
    ignoradas_sem_data: 0,
    ignoradas_status_desconhecido: 0,
    upserts: 0,
    operacao: 0,
    corretiva: 0,
    indisponibilidade: 0,
    interdicao: 0,
    preventiva_isenta: 0,
    nao_operado_isento: 0,
    falhas: [],
  };

  const tagsCriadas = new Set();

  const catMap = {
    [STATUS_OPERACAO]:          'operacao',
    [STATUS_CORRETIVA]:         'corretiva',
    [STATUS_INDISPONIBILIDADE]: 'indisponibilidade',
    [STATUS_INTERDICAO]:        'interdicao',
    [STATUS_PREVENTIVA]:        'preventiva_isenta',
    [STATUS_NAO_OPERADO]:       'nao_operado_isento',
  };

  for (let i = 0; i < dados.length; i++) {
    const linha = dados[i];
    const numLinha = i + 2;
    try {
      const tagRaw  = normalizar(linha[IDX_TAG]);
      const dataRaw = linha[IDX_DATA];
      const stRaw   = normalizar(linha[IDX_STATUS]);

      const dataDate = excelSerialParaDateBI(dataRaw);
      if (!dataDate) { resumo.ignoradas_sem_data++; continue; }

      const statusOperacional = mapearStatusBI(stRaw);
      if (statusOperacional === null)      { resumo.ignoradas_pendente++; continue; }
      if (statusOperacional === undefined) { resumo.ignoradas_status_desconhecido++; continue; }

      await garantirTagBI(tagRaw, tagsCriadas);

      const dataISO = dataDate.toISOString().slice(0, 10);
      const dataUTC = new Date(`${dataISO}T00:00:00.000Z`);

      const existente = await prisma.parteDiaria.findFirst({
        where: { tag: tagRaw, data: dataUTC },
        select: { id: true },
      });

      if (existente) {
        await prisma.parteDiaria.update({
          where: { id: existente.id },
          data: {
            status_operacional: statusOperacional,
            status_relatorio:   'APROVADO',
            status_aprovacao:   'Aprovado',
            atualizado_por:     'importacao-historico-api',
          },
        });
      } else {
        await prisma.parteDiaria.create({
          data: {
            tag:                tagRaw,
            data:               dataUTC,
            status:             'APROVADO',
            status_operacional: statusOperacional,
            status_relatorio:   'APROVADO',
            status_aprovacao:   'Aprovado',
            status_assinatura:  'APROVADO',
            possui_pendencia:   false,
            criado_por:         'importacao-historico-api',
            atualizado_por:     'importacao-historico-api',
          },
        });
      }

      resumo.upserts++;
      resumo.processadas++;
      const cat = catMap[statusOperacional];
      if (cat) resumo[cat]++;
    } catch (e) {
      const tagTxt = normalizar(linha[IDX_TAG]) || `linha ${numLinha}`;
      resumo.falhas.push({ linha: numLinha, tag: tagTxt, erro: e.message });
    }
  }

  const status = resumo.falhas.length > 0 ? 207 : 200;
  return res.status(status).json({ data: { aba: nomeAba, resumo } });
});
