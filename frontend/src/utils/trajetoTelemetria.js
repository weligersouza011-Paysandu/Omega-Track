// ============================================================================
// frontend/src/utils/trajetoTelemetria.js — regras puras da aba "Trajeto &
// Rastreabilidade" e do alerta de placas sem cadastro (sem React, testáveis).
// Datas e horas da tela são de Brasília (-03:00), como no back-end.
// ============================================================================

const FUSO_MS = -3 * 60 * 60 * 1000;
export const MAX_DIAS_TRAJETO = 31;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Placa normalizada: maiúsculas, sem hífen/espaços; "QVN4G02 CT-251" -> "QVN4G02". */
export function normalizarPlaca(valor) {
  const limpo = String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const placa = limpo.match(/[A-Z]{3}[0-9][A-Z0-9][0-9]{2}/);
  return placa ? placa[0] : limpo;
}

/** Data de hoje (ou `dias` a partir dela) em -03:00, AAAA-MM-DD. */
export function dataBrasilia(dias = 0, agora = new Date()) {
  return new Date(agora.getTime() + FUSO_MS + dias * DIA_MS).toISOString().slice(0, 10);
}

export const ATALHOS_PERIODO = [
  { id: 'hoje', label: 'Hoje', inicio: 0, fim: 0 },
  { id: 'ontem', label: 'Ontem', inicio: -1, fim: -1 },
  { id: '7dias', label: 'Últimos 7 dias', inicio: -6, fim: 0 },
];

export function periodoDoAtalho(id, agora = new Date()) {
  const atalho = ATALHOS_PERIODO.find((a) => a.id === id);
  if (!atalho) return null;
  return { dataInicio: dataBrasilia(atalho.inicio, agora), dataFim: dataBrasilia(atalho.fim, agora) };
}

/** Qual atalho corresponde ao período atual (para destacar o botão). */
export function atalhoAtivo(filtro, agora = new Date()) {
  return ATALHOS_PERIODO.find((a) => {
    const p = periodoDoAtalho(a.id, agora);
    return p.dataInicio === filtro.dataInicio && p.dataFim === filtro.dataFim;
  })?.id ?? null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Mensagem de erro do filtro (as mesmas regras do back-end) ou null. */
export function validarFiltroTrajeto({ dataInicio, dataFim, horaInicio = '00:00', horaFim = '23:59' } = {}) {
  if (!DATA.test(dataInicio || '')) return 'Informe a data inicial.';
  if (!DATA.test(dataFim || '')) return 'Informe a data final.';
  if (dataFim < dataInicio) return 'A data final deve ser igual ou posterior à inicial.';
  const dias = Math.round((Date.parse(`${dataFim}T00:00:00Z`) - Date.parse(`${dataInicio}T00:00:00Z`)) / DIA_MS) + 1;
  if (dias > MAX_DIAS_TRAJETO) return `Consulte no máximo ${MAX_DIAS_TRAJETO} dias por vez.`;
  if (!HORA.test(horaInicio || '') || !HORA.test(horaFim || '')) return 'Informe as horas no formato HH:mm.';
  if (horaFim < horaInicio) return 'A hora final deve ser igual ou posterior à inicial.';
  return null;
}

/** Query string de GET /api/telemetria/trajeto. */
export function paramsTrajeto({ veiculo, dataInicio, dataFim, horaInicio, horaFim }) {
  const p = new URLSearchParams({ dataInicio, dataFim, horaInicio: horaInicio || '00:00', horaFim: horaFim || '23:59' });
  if (veiculo && String(veiculo).trim()) p.set('veiculo', String(veiculo).trim());
  return p.toString();
}

/** Veículos da frota que casam com a busca (TAG ou placa, sem caixa/hífen/espaços). */
export function filtrarVeiculos(veiculos, busca, limite = 50) {
  const termo = String(busca ?? '').trim();
  const chave = termo.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const lista = !chave ? veiculos : veiculos.filter((v) => (
    String(v.tag ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(chave)
    || String(v.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(chave)
  ));
  return [...lista]
    .sort((a, b) => String(a.tag).localeCompare(String(b.tag), 'pt-BR', { numeric: true }))
    .slice(0, limite);
}

export const STATUS_MOBILIZACAO = {
  MOBILIZADO: { label: 'Mobilizado', classe: 'bg-green-50 text-status-verde ring-green-600/20' },
  DESMOBILIZADO: { label: 'Desmobilizado', classe: 'bg-slate-100 text-slate-600 ring-slate-500/25' },
  NAO_CADASTRADO: { label: 'Não cadastrado', classe: 'bg-amber-50 text-status-amarelo ring-amber-600/25' },
};

/** "Mobilizado" / "Desmobilizado" do cadastro -> chave de STATUS_MOBILIZACAO. */
export function statusDoCadastro(veiculo) {
  if (!veiculo) return 'NAO_CADASTRADO';
  return String(veiculo.status || '').trim().toLowerCase() === 'desmobilizado' ? 'DESMOBILIZADO' : 'MOBILIZADO';
}

export function temCoordenadas(p) {
  return Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude)
    && !(p.latitude === 0 && p.longitude === 0);
}

/**
 * Pontos georreferenciados agrupados por veículo (TAG ou placa normalizada), cada grupo
 * em ordem cronológica — uma linha por veículo quando a consulta não tem veículo.
 */
export function agruparTrajetos(pontos) {
  const grupos = new Map();
  for (const p of pontos) {
    if (!temCoordenadas(p)) continue;
    const chave = p.tag || normalizarPlaca(p.tag_placa) || 'SEM_PLACA';
    if (!grupos.has(chave)) grupos.set(chave, { chave, tag: p.tag || null, placa: normalizarPlaca(p.tag_placa), pontos: [] });
    grupos.get(chave).pontos.push(p);
  }
  for (const g of grupos.values()) {
    g.pontos.sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));
  }
  return [...grupos.values()];
}

/** Velocidade / limite para a tabela e o popup. */
export function textoVelocidade(p) {
  const v = Number.isFinite(p?.valor) ? `${Math.round(p.valor)} km/h` : '—';
  return Number.isFinite(p?.limite) && p.limite > 0 ? `${v} / ${Math.round(p.limite)} km/h` : v;
}

/** Quem pode excluir a telemetria de uma placa (mesma regra do back-end). */
export function podeExcluirPorPlaca(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR'
    && (usuario.nivel === 'MASTER' || ['GESTAO', 'PLANEJADOR', 'TRANSPORTE'].includes(usuario.setor));
}

const registros = (n) => `${n} ${n === 1 ? 'registro' : 'registros'}`;

export function textoAlertaPlacas(n) {
  return n === 1
    ? '1 placa na telemetria não está mobilizada nem desmobilizada nos registros'
    : `${n} placas na telemetria não estão mobilizadas nem desmobilizadas nos registros`;
}

export function rotuloPlacaSemCadastro(p) {
  return `${p.placa} • ${registros(p.totalEventos)}`;
}

export function textoConfirmacaoExclusao(p) {
  return p.totalEventos === 1
    ? `Excluir o único registro de telemetria da placa ${p.placa}?`
    : `Excluir todos os ${p.totalEventos} registros de telemetria da placa ${p.placa}?`;
}
