// ============================================================================
// src/services/telemetriaTrajetoService.js — regras puras do trajeto e do cruzamento
// de placas da telemetria com a frota (mob_desmob). Sem acesso ao banco: o controller
// busca os dados e usa estas funções (testáveis isoladamente).
// ============================================================================
import { chavePlaca, erroHttp } from './telemetriaPlanilhaService.js';

const MINUTO_MS = 60 * 1000;
const DIA_MS = 24 * 60 * MINUTO_MS;
/** Brasília (-03:00): hora local = UTC - 3 h, logo UTC = local + 3 h. */
const FUSO_MIN = -180;
export const MAX_DIAS_TRAJETO = 31;

export const STATUS_MOBILIZACAO = Object.freeze({
  MOBILIZADO: 'MOBILIZADO',
  DESMOBILIZADO: 'DESMOBILIZADO',
  NAO_CADASTRADO: 'NAO_CADASTRADO',
});

/** Placa normalizada: maiúsculas, sem hífen e sem espaços (ex.: "qvn-4g02 CT-251" -> "QVN4G02"). */
export function normalizarPlaca(valor) {
  return chavePlaca(valor ?? '');
}

/** "AAAA-MM-DD" válido (inclusive dia do mês) -> { ano, mes, dia }. */
function lerData(texto, campo) {
  const m = String(texto ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw erroHttp(400, `O campo "${campo}" e obrigatorio no formato AAAA-MM-DD.`);
  const [ano, mes, dia] = [+m[1], +m[2], +m[3]];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw erroHttp(400, `O campo "${campo}" nao e uma data valida.`);
  }
  return d.getTime();
}

/** "HH:mm" -> minutos desde a meia-noite. */
function lerHora(texto, campo, padrao) {
  if (texto === undefined || texto === null || String(texto).trim() === '') return padrao;
  const m = String(texto).trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw erroHttp(400, `O campo "${campo}" deve estar no formato HH:mm (00:00 a 23:59).`);
  return +m[1] * 60 + +m[2];
}

/**
 * Valida os filtros do trajeto e monta as janelas em UTC.
 * Cada dia do período gera a janela [dia horaInicio:00, dia horaFim:59.999] em -03:00,
 * ou seja, `fim` é exclusivo e vale horaFim + 1 min.
 */
export function lerFiltroTrajeto(query = {}) {
  const inicioDia = lerData(query.dataInicio, 'dataInicio');
  const fimDia = lerData(query.dataFim, 'dataFim');
  if (fimDia < inicioDia) throw erroHttp(400, 'O campo "dataFim" deve ser igual ou posterior a "dataInicio".');
  const dias = Math.round((fimDia - inicioDia) / DIA_MS) + 1;
  if (dias > MAX_DIAS_TRAJETO) throw erroHttp(400, `Consulte no maximo ${MAX_DIAS_TRAJETO} dias de trajeto por vez.`);

  const horaInicio = lerHora(query.horaInicio, 'horaInicio', 0);
  const horaFim = lerHora(query.horaFim, 'horaFim', 23 * 60 + 59);
  if (horaFim < horaInicio) throw erroHttp(400, 'O campo "horaFim" deve ser igual ou posterior a "horaInicio".');

  const veiculo = String(query.veiculo ?? '').trim();
  if (veiculo.length > 60) throw erroHttp(400, 'O campo "veiculo" deve ter no maximo 60 caracteres.');

  const deslocamento = -FUSO_MIN * MINUTO_MS; // +3 h
  const janelas = [];
  for (let i = 0; i < dias; i += 1) {
    const dia = inicioDia + i * DIA_MS + deslocamento;
    janelas.push({ inicio: new Date(dia + horaInicio * MINUTO_MS), fim: new Date(dia + (horaFim + 1) * MINUTO_MS) });
  }
  const p = (n) => String(n).padStart(2, '0');
  const hora = (min) => `${p(Math.floor(min / 60))}:${p(min % 60)}`;
  return {
    veiculo: veiculo || null,
    dataInicio: new Date(inicioDia).toISOString().slice(0, 10),
    dataFim: new Date(fimDia).toISOString().slice(0, 10),
    horaInicio: hora(horaInicio),
    horaFim: hora(horaFim),
    diaInteiro: horaInicio === 0 && horaFim === 23 * 60 + 59,
    janelas,
  };
}

/**
 * `where.data_hora` do trajeto: um intervalo externo (usa o índice de data_hora) e,
 * quando a janela não cobre o dia inteiro, um OR com a janela de cada dia.
 */
export function filtroDataHoraTrajeto(filtro) {
  const { janelas } = filtro;
  const externo = { data_hora: { gte: janelas[0].inicio, lt: janelas[janelas.length - 1].fim } };
  if (filtro.diaInteiro || janelas.length === 1) return externo;
  return { AND: [externo, { OR: janelas.map((j) => ({ data_hora: { gte: j.inicio, lt: j.fim } })) }] };
}

/** Status do cadastro (mob_desmob) -> status de mobilização da API. */
export function statusMobilizacao(veiculo) {
  if (!veiculo) return STATUS_MOBILIZACAO.NAO_CADASTRADO;
  if (veiculo.deletado_em || String(veiculo.status || '').trim().toLowerCase() === 'desmobilizado') {
    return STATUS_MOBILIZACAO.DESMOBILIZADO;
  }
  return STATUS_MOBILIZACAO.MOBILIZADO;
}

/** Mapa placa/TAG normalizada -> veículo, com toda a frota (mobilizados, desmobilizados e lixeira). */
export function indexarFrota(veiculos = []) {
  const mapa = new Map();
  for (const v of veiculos) {
    for (const chave of [normalizarPlaca(v.placa), normalizarPlaca(v.tag)]) {
      if (chave && !mapa.has(chave)) mapa.set(chave, v);
    }
  }
  return mapa;
}

/** Trecho que aparece em qualquer grafia da placa ("ABC1D23", "abc-1d23", "ABC 1D23 CT-9"). */
export function trechoBuscaPlaca(chave) {
  return chave.length > 4 ? chave.slice(-4) : chave;
}

/**
 * Agrupa (por placa normalizada) os grupos de `tag_placa` da telemetria e devolve só os
 * que não têm vínculo nenhum com a frota. Desmobilizado tem vínculo: não gera alerta.
 * `grupos`: [{ tag_placa, tag, _count: { _all }, _min: { data_hora }, _max: { data_hora } }]
 */
export function placasSemCadastro(grupos, frota) {
  const placas = new Map();
  for (const g of grupos) {
    const placa = normalizarPlaca(g.tag_placa);
    if (!placa) continue;
    const atual = placas.get(placa) || { placa, totalEventos: 0, primeiroRegistro: null, ultimoRegistro: null, tags: new Set() };
    atual.totalEventos += g._count?._all ?? 0;
    const min = g._min?.data_hora ? new Date(g._min.data_hora) : null;
    const max = g._max?.data_hora ? new Date(g._max.data_hora) : null;
    if (min && (!atual.primeiroRegistro || min < atual.primeiroRegistro)) atual.primeiroRegistro = min;
    if (max && (!atual.ultimoRegistro || max > atual.ultimoRegistro)) atual.ultimoRegistro = max;
    if (g.tag) atual.tags.add(normalizarPlaca(g.tag));
    placas.set(placa, atual);
  }
  return [...placas.values()]
    .filter((p) => !frota.has(p.placa) && ![...p.tags].some((t) => frota.has(t)))
    .map(({ tags, ...p }) => p)
    .sort((a, b) => b.totalEventos - a.totalEventos || a.placa.localeCompare(b.placa));
}
