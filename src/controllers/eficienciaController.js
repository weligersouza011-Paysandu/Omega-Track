// ============================================================================
// Motor de calculo do Dashboard de Eficiencia de Transporte.
//
// Regra de valoracao da Parte Diaria (campo `status_operacional`):
//   - "Operacao" ......................................... valor 1 (sucesso);
//   - "Manutencao Corretiva" / "Indisponibilidade" /
//     "Interdicao" ...................................... valor 0 (desvio);
//   - "Manutencao Preventiva" ............................ parada programada:
//        ISENTA do denominador da eficiencia; conta apenas como total;
//   - Dia util (seg-sab) sem lancamento, dentro da janela de mobilizacao e
//     sem descarte manual: conta como PENDENTE.
//
//   Eficiencia = Operacao / (Operacao + Desvios)
//
// GET /api/eficiencia?dataInicio=&dataFim=&tag=&modelo=&contrato=&situacao=
//   situacao: MOB (padrao — frota mobilizada) | DESMOB | TODOS.
//   Periodo padrao: inicio do mes (hoje - 5 meses) ate hoje; maximo 366 dias.
//
// Resposta: indicadores globais, eficiencia por TAG e por MODELO (crescente),
// evolucao mensal, calendario de paradas por dia e opcoes de filtro.
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { comRetryConexao } from '../utils/retryBanco.js';

const STATUS_OPERACAO = 'Operação';
const STATUS_CORRETIVA = 'Manutenção Corretiva';
const STATUS_PREVENTIVA = 'Manutenção Preventiva';
const STATUS_INDISPONIBILIDADE = 'Indisponibilidade';
const STATUS_INTERDICAO = 'Interdição';

// Secoes do dashboard (chaves usadas nos acumuladores e na resposta).
const SECOES = ['operacao', 'corretiva', 'preventiva', 'interdicao', 'indisponibilidade'];
// Secoes de manutencao listadas no calendario de paradas (por veiculo).
const SECOES_CALENDARIO = ['corretiva', 'preventiva', 'interdicao', 'indisponibilidade'];

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

function normalizar(v) {
  return String(v || '').trim();
}

// Mapeia o status_operacional da Parte Diaria para a secao do dashboard.
function secaoDoStatus(status) {
  const valor = normalizar(status);
  if (valor === STATUS_OPERACAO) return 'operacao';
  if (valor === STATUS_CORRETIVA) return 'corretiva';
  if (valor === STATUS_PREVENTIVA) return 'preventiva';
  if (valor === STATUS_INDISPONIBILIDADE) return 'indisponibilidade';
  if (valor === STATUS_INTERDICAO) return 'interdicao';
  return null; // status fora do dominio: ignora
}

function zerado() {
  return { operacao: 0, corretiva: 0, preventiva: 0, interdicao: 0, indisponibilidade: 0, pendentes: 0 };
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
    total_registrado: stats.operacao + stats.corretiva + stats.preventiva + stats.interdicao + stats.indisponibilidade,
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
        select: { tag: true, data: true, status_operacional: true, operador: true, funcionario: true },
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

  for (const v of veiculos) {
    porTag.set(normalizar(v.tag), {
      tag: v.tag,
      placa: v.placa,
      modelo: normalizar(v.modelo) || 'Sem modelo',
      contrato: normalizar(v.contrato) || null,
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
  const totalObservado = baseEficiencia + totais.preventiva + totais.pendentes;
  const pct = (n) => (totalObservado > 0 ? n / totalObservado : null);

  const porTagLista = [...porTag.values()]
    .map(comIndicadores)
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
