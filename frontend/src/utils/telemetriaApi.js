// ============================================================================
// frontend/src/utils/telemetriaApi.js — chamadas e formatação do módulo
// Telemetria & Fadiga (compartilhado entre a tela e os componentes da aba Fadiga).
// ============================================================================
import { lerSessao } from './sessao.js';

export function obterHeaders(json = false) {
  const sessao = lerSessao();
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (sessao?.token) headers.Authorization = `Bearer ${sessao.token}`;
  if (sessao?.usuario?.matricula) headers['x-acting-matricula'] = sessao.usuario.matricula;
  return headers;
}

export async function lerJson(resposta, padrao) {
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.message || dados.error || `${padrao} (${resposta.status}).`);
  return dados;
}

/** GET/POST/PATCH/DELETE em /api/telemetria{caminho}; `corpo` vira JSON. */
export async function apiTelemetria(caminho, { metodo = 'GET', corpo, erro = 'Falha na requisicao' } = {}) {
  const resposta = await fetch(`/api/telemetria${caminho}`, {
    method: metodo,
    headers: obterHeaders(corpo !== undefined),
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  return lerJson(resposta, erro);
}

export function formatarDataHora(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatarData(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '—';
  // Datas DATE chegam como meia-noite UTC: formata sem converter o fuso.
  return data.toISOString().slice(0, 10).split('-').reverse().join('/');
}

export function formatarHora(valor) {
  if (!valor) return '';
  return new Date(valor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Mês "AAAA-MM" -> "nov/2026". */
export function rotuloMes(referencia) {
  const [ano, mes] = String(referencia).split('-').map(Number);
  if (!ano || !mes) return referencia;
  return `${new Date(Date.UTC(ano, mes - 1, 15)).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')}/${ano}`;
}

/** Hoje + N dias, em AAAA-MM-DD (fuso local). */
export function dataMaisDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Farol da fadiga detectada (classificação calculada no back-end). */
export const FAROL_FADIGA = {
  CONFIRMADA: {
    label: 'Fadiga confirmada', curto: 'Confirmada', cor: '#EF4444',
    classe: 'bg-red-50 text-status-vermelho ring-red-600/25',
    descricao: 'Em movimento e repetida em até 15 min (ou confirmada pela Central). Crítico N3.',
  },
  EM_ANALISE: {
    label: 'Em análise', curto: 'Em análise', cor: '#EAB308',
    classe: 'bg-amber-50 text-status-amarelo ring-amber-600/25',
    descricao: 'Em movimento, detecção isolada. A Central confirma ou descarta pelo vídeo.',
  },
  VEICULO_PARADO: {
    label: 'Veículo parado', curto: 'Parado', cor: '#94A3B8',
    classe: 'bg-slate-100 text-slate-600 ring-slate-500/25',
    descricao: 'Abaixo de 10 km/h (gatilho do PGS, item 7.1). Não conta na matriz.',
  },
  DESCARTADA: {
    label: 'Descartada', curto: 'Descartada', cor: '#475569',
    classe: 'bg-slate-100 text-slate-500 ring-slate-500/25 line-through',
    descricao: 'Descartada pela Central (falso positivo, uso como benefício etc.).',
  },
};

export const STATUS_PLANO = {
  ABERTO: { label: 'Aberto', classe: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
  EM_ANDAMENTO: { label: 'Em andamento', classe: 'bg-amber-50 text-status-amarelo ring-amber-600/20' },
  CONCLUIDO: { label: 'Concluído', classe: 'bg-green-50 text-status-verde ring-green-600/20' },
  CANCELADO: { label: 'Cancelado', classe: 'bg-slate-100 text-slate-500 ring-slate-500/20' },
};

/** Farol do excesso de velocidade (ocorrência = linhas do mesmo veículo a até 2 min). */
export const FAROL_VELOCIDADE = {
  CONFIRMADA: {
    label: 'Excesso confirmado', curto: 'Confirmado', cor: '#EF4444',
    classe: 'bg-red-50 text-status-vermelho ring-red-600/25',
    descricao: '10 s ou mais acima do limite (gatilho do PGS, item 7.1), Crítico em qualquer duração, ou confirmado pela Central.',
  },
  ABAIXO_GATILHO: {
    label: 'Abaixo do gatilho', curto: 'Abaixo de 10 s', cor: '#EAB308',
    classe: 'bg-amber-50 text-status-amarelo ring-amber-600/25',
    descricao: 'Acima de 7%, mas menos de 10 s (ou sem duração). A Central confirma ou descarta.',
  },
  TOLERANCIA: {
    label: 'Tolerância', curto: 'Até 7%', cor: '#94A3B8',
    classe: 'bg-slate-100 text-slate-600 ring-slate-500/25',
    descricao: 'Até 7% acima do limite. Sem conduta a avaliar.',
  },
  DESCARTADA: {
    label: 'Descartado', curto: 'Descartado', cor: '#475569',
    classe: 'bg-slate-100 text-slate-500 ring-slate-500/25 line-through',
    descricao: 'Descartado pela Central (ex.: veículo de emergência, uso como benefício comprovado).',
  },
};

/** Faixas do Anexo I (GRAVE = "Significativo"). */
export const FAIXA_VELOCIDADE = {
  MODERADO: { label: 'Moderado', faixa: '>7% e ≤20%', classificacao: 'N5', cor: '#F59E0B' },
  GRAVE: { label: 'Significativo', faixa: '>20% e ≤50%', classificacao: 'N3', cor: '#F97316' },
  CRITICO: { label: 'Crítico', faixa: '>50% e/ou >120 km/h', classificacao: 'N3', cor: '#DC2626' },
  NORMAL: { label: 'Tolerância', faixa: '≤7%', classificacao: null, cor: '#94A3B8' },
};

export const ROTULO_LINHA_MATRIZ = {
  FADIGA_VERDADEIRA: 'Fadiga verdadeira',
  PRONTIDAO: 'Não conformidade na Prontidão',
  SEM_PARADA: 'Sem parada obrigatória em 15 min',
  VELOCIDADE_MODERADO: 'Velocidade — Moderado (>7% e ≤20%)',
  VELOCIDADE_GRAVE: 'Velocidade — Significativo (>20% e ≤50%)',
  VELOCIDADE_CRITICO: 'Velocidade — Crítico (>50% e/ou >120 km/h)',
};

export function formatarDuracao(segundos) {
  if (segundos === null || segundos === undefined) return 'sem duração';
  return segundos >= 60 ? `${Math.floor(segundos / 60)} min ${segundos % 60} s` : `${segundos} s`;
}

export function ordinal(n) {
  if (!n) return '—';
  return n >= 3 ? '3º ou mais' : `${n}º`;
}
