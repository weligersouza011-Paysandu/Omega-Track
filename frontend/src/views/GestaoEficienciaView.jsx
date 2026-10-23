import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  BarChart3,
  FilterX,
  Gauge,
  Hammer,
  LayoutGrid,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Truck,
  Wrench,
} from 'lucide-react';
import { authHeaders } from '../utils/sessao.js';
import { hojeISO } from '../utils/datas.js';
import MatrizCalendarioMensal from '../components/MatrizCalendarioMensal.jsx';

// ============================================================================
// Dashboard de Eficiencia de Transporte (layout escuro corporativo).
// Consome GET /api/eficiencia: KPIs (corretiva/preventiva/interdicao/operacao/
// indisponibilidade), gauge de eficiencia geral, barras por TAG e por modelo,
// evolucao mensal e interdições por veiculo.
//
// Os filtros globais desta secao (TAG/Modelo/Contrato/MOB-DESMOB/datas)
// afetam SOMENTE este painel superior. A Matriz Calendario inferior e
// totalmente independente: tem seletor de mes proprio e nao recebe filtros
// desta view.
//
// Escala de cores de eficiencia (rigorosa, sobre o percentual exibido com 1 casa):
//   100,0% ........ Azul     #3B82F6 (exclusivo)
//    99,0–99,9% ... Verde    #10B981
//    90,0–98,9% ... Amarelo  #F59E0B
//    85,0–89,9% ... Laranja  #D97706
//    < 85,0% ....... Vermelho #EF4444
// ============================================================================

const CORES_EFICIENCIA = {
  azul: '#3B82F6',
  verde: '#10B981',
  amarelo: '#F59E0B',
  laranja: '#D97706',
  vermelho: '#EF4444',
  neutro: '#475569',
};

const FAIXAS_EFICIENCIA = [
  { rotulo: '100,0%', cor: CORES_EFICIENCIA.azul },
  { rotulo: '99,0–99,9%', cor: CORES_EFICIENCIA.verde },
  { rotulo: '90,0–98,9%', cor: CORES_EFICIENCIA.amarelo },
  { rotulo: '85,0–89,9%', cor: CORES_EFICIENCIA.laranja },
  { rotulo: '< 85,0%', cor: CORES_EFICIENCIA.vermelho },
];

// Arcos proporcionais do gauge (0 a 1) alinhados as faixas acima.
const ARCOS_GAUGE = [
  { inicio: 0.004, fim: 0.843, cor: CORES_EFICIENCIA.vermelho },
  { inicio: 0.857, fim: 0.893, cor: CORES_EFICIENCIA.laranja },
  { inicio: 0.907, fim: 0.987, cor: CORES_EFICIENCIA.amarelo },
  { inicio: 0.993, fim: 0.9965, cor: CORES_EFICIENCIA.verde },
  { inicio: 0.9995, fim: 1, cor: CORES_EFICIENCIA.azul },
];

const SECOES = {
  operacao: { rotulo: 'Operação', curto: 'Operação', cor: '#10B981', classe: 'text-emerald-400' },
  corretiva: { rotulo: 'Manutenção Corretiva', curto: 'Corretiva', cor: '#EF4444', classe: 'text-red-400' },
  preventiva: { rotulo: 'Manutenção Preventiva', curto: 'Preventiva', cor: '#F59E0B', classe: 'text-amber-400' },
  interdicao: { rotulo: 'Interdição', curto: 'Interdição', cor: '#D97706', classe: 'text-orange-400' },
  indisponibilidade: { rotulo: 'Indisponibilidade', curto: 'Indisp.', cor: '#8B5CF6', classe: 'text-violet-400' },
};

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const fmtNum = (n) => Number(n || 0).toLocaleString('pt-BR');
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

function corPorEficiencia(v) {
  if (v === null || v === undefined) return CORES_EFICIENCIA.neutro;
  const percentual = Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10;
  if (percentual >= 100) return CORES_EFICIENCIA.azul;
  if (percentual >= 99) return CORES_EFICIENCIA.verde;
  if (percentual >= 90) return CORES_EFICIENCIA.amarelo;
  if (percentual >= 85) return CORES_EFICIENCIA.laranja;
  return CORES_EFICIENCIA.vermelho;
}

// ---------------------------------------------------------------------------
// Componentes de apoio
// ---------------------------------------------------------------------------
function Card({ children, className = '' }) {
  return <section className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg sm:p-5 ${className}`}>{children}</section>;
}

function TituloCard({ icone: Icone, titulo, subtitulo, extra }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icone size={17} className="shrink-0 text-sky-400" />
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-bold text-slate-100 2xl:text-sm" title={titulo}>{titulo}</h2>
          {subtitulo && <p className="truncate text-[10px] text-slate-500 2xl:text-[11px]" title={subtitulo}>{subtitulo}</p>}
        </div>
      </div>
      {extra}
    </div>
  );
}

function FiltroSelect({ rotulo, valor, onChange, opcoes, vazio = 'Todos' }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{rotulo}</span>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm font-medium text-slate-200 outline-none transition-colors focus:border-sky-500"
      >
        <option value="">{vazio}</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.rotulo}</option>
        ))}
      </select>
    </label>
  );
}

function FiltroData({ rotulo, valor, onChange, min, max }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{rotulo}</span>
      <input
        type="date"
        value={valor}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm font-medium text-slate-200 outline-none transition-colors focus:border-sky-500"
      />
    </label>
  );
}

// Gauge semicircular com ponteiro (SVG puro) e escala rigorosa de 5 faixas.
function GaugeEficiencia({ valor }) {
  const temValor = valor !== null && valor !== undefined;
  const e = temValor ? Math.max(0, Math.min(1, valor)) : 0;
  const cx = 120;
  const cy = 120;
  const r = 96;
  const ponto = (v) => {
    const t = Math.PI * (1 - v);
    return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  };
  const arco = (v1, v2) => {
    const [x1, y1] = ponto(v1);
    const [x2, y2] = ponto(v2);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const angulo = -90 + 180 * e;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 240 138" className="w-full max-w-[280px]">
        {ARCOS_GAUGE.map((faixa) => (
          <path
            key={faixa.cor}
            d={arco(faixa.inicio, faixa.fim)}
            stroke={faixa.cor}
            strokeWidth="15"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
        ))}
        <g transform={`rotate(${angulo} ${cx} ${cy})`}>
          <polygon points={`${cx - 4},${cy} ${cx + 4},${cy} ${cx},${cy - r + 26}`} fill="#e2e8f0" />
        </g>
        <circle cx={cx} cy={cy} r="9" fill="#0f172a" stroke="#e2e8f0" strokeWidth="3" />
      </svg>
      <div className="-mt-3 text-center">
        <div className="text-4xl font-extrabold tabular-nums tracking-tight" style={{ color: temValor ? corPorEficiencia(valor) : '#ffffff' }}>
          {temValor ? `${(e * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—'}
        </div>
        <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Eficiência Geral</div>
        <div className="mt-0.5 text-[10px] text-slate-500">Operação ÷ (Operação + Desvios)</div>
      </div>
    </div>
  );
}

function FaixasEficiencia({ className = '' }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 ${className}`}>
      {FAIXAS_EFICIENCIA.map((faixa) => (
        <span key={faixa.rotulo} className="flex items-center gap-1 text-[10px] font-semibold text-slate-400">
          <span className="h-2 w-2 rounded-full" style={{ background: faixa.cor }} />
          {faixa.rotulo}
        </span>
      ))}
    </div>
  );
}

// Barras horizontais genéricas (TAG / Modelo).
function BarrasHorizontais({ itens, maxAltura = 'min-h-[280px] max-h-[280px]', descricaoValor, corDe = corPorEficiencia }) {
  if (!itens.length) {
    return <div className="mt-3 flex min-h-[280px] items-center justify-center overflow-y-auto rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-center text-xs text-slate-500">Sem dados no período.</div>;
  }
  return (
    <div className={`mt-3 space-y-3 overflow-y-auto pr-1 ${maxAltura}`}>
      {itens.map((item) => {
        const cor = corDe(item.valor);
        return (
          <div key={item.chave} title={item.tooltip}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] font-semibold text-slate-200">
                {item.rotulo}
                {item.sub && <span className="ml-1.5 font-normal text-slate-500">{item.sub}</span>}
              </span>
              <span className="shrink-0 text-right text-[11px] font-bold tabular-nums" style={{ color: cor }}>
                {item.rotuloValor ?? fmtPct(item.valor)}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${(item.valor ?? 0) * 100}%`, background: cor }}
              />
            </div>
            {descricaoValor && item.descricao && (
              <div className="mt-0.5 text-[10px] text-slate-500">{item.descricao}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function KpiCard({ chave, total, percentual }) {
  const cfg = SECOES[chave];
  const Icone = {
    operacao: Activity,
    corretiva: Wrench,
    preventiva: Hammer,
    interdicao: ShieldAlert,
    indisponibilidade: Ban,
  }[chave];
  return (
    <div
      className="relative min-h-[100px] overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 p-3.5"
      title={cfg.rotulo}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: cfg.cor }} />
      <div className="flex items-center gap-1.5">
        <Icone size={13} style={{ color: cfg.cor }} className="hidden shrink-0 2xl:block" />
        <span className="min-w-0 truncate text-[7.5px] font-bold uppercase tracking-tight text-slate-400 2xl:text-[9px] 2xl:tracking-wide" title={cfg.curto}>{cfg.curto}</span>
      </div>
      <div className="mt-2 text-2xl font-extrabold tabular-nums text-white">{fmtPct(percentual)}</div>
      <div className="whitespace-nowrap text-[10px] text-slate-400 2xl:text-[11px]">{fmtNum(total)} {total === 1 ? 'dia' : 'dias'}</div>
    </div>
  );
}

function EstadoCarregando() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-2xl bg-slate-900" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="h-96 animate-pulse rounded-2xl bg-slate-900 xl:col-span-6" />
        <div className="h-96 animate-pulse rounded-2xl bg-slate-900 xl:col-span-6" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel de interdições com tooltip rico: motivo, datas, TAG e impactos.
// ---------------------------------------------------------------------------
function CorpoTooltipInterdicao({ detalhes }) {
  const datas = detalhes.datas || [];
  const datasVisiveis = datas.slice(0, 12);
  const restantes = datas.length - datasVisiveis.length;

  return (
    <>
      <div className="flex items-start justify-between gap-2 border-b border-slate-700 pb-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold text-white">{detalhes.tag}</div>
          <div className="truncate text-[10px] text-slate-400">
            {[detalhes.placa, detalhes.modelo].filter(Boolean).join(' · ') || 'Sem placa/modelo'}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-orange-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-orange-300">
          Interdição
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Contrato</div>
          <div className="truncate font-semibold text-slate-200">{detalhes.contrato || '—'}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Situação</div>
          <div className="truncate font-semibold text-slate-200">{detalhes.status || '—'}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Dias interditados</div>
          <div className="font-semibold text-slate-200">{fmtNum(detalhes.dias)} {detalhes.dias === 1 ? 'dia' : 'dias'}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Impacto no período</div>
          <div className="font-semibold text-slate-200">{fmtPct(detalhes.percentualDias)}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Desvios acumulados</div>
          <div className="font-semibold text-slate-200">{fmtNum(detalhes.desvio)} dia(s)</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Eficiência da TAG</div>
          <div className="font-bold" style={{ color: corPorEficiencia(detalhes.eficiencia) }}>{fmtPct(detalhes.eficiencia)}</div>
        </div>
      </div>

      <div className="mt-2 border-t border-slate-700/70 pt-2">
        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Motivo</div>
        <p className="mt-0.5 text-[10px] leading-snug text-slate-300">{detalhes.motivo || 'Não informado no apontamento.'}</p>
      </div>

      <div className="mt-2">
        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Datas ({datas.length})</div>
        <p className="mt-0.5 text-[10px] leading-snug text-slate-300">
          {datas.length ? datasVisiveis.map(dataBR).join(', ') : '—'}
          {restantes > 0 ? ` e mais ${restantes}` : ''}
        </p>
      </div>
    </>
  );
}

function InterdicoesPainel({ itens, maxAltura = 'min-h-[280px] max-h-[280px]' }) {
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    setTooltip(null);
  }, [itens]);

  if (!itens.length) {
    return <div className="mt-3 flex min-h-[280px] items-center justify-center overflow-y-auto rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-center text-xs text-slate-500">Sem interdições no período.</div>;
  }

  const larguraTooltip = 332;
  const alturaTooltip = 300;

  const mostrar = (item, event) => {
    const x = Math.min(Math.max(12, event.clientX + 16), window.innerWidth - larguraTooltip - 12);
    const y = Math.min(Math.max(12, event.clientY + 16), window.innerHeight - alturaTooltip - 12);
    setTooltip({ item, x, y });
  };

  const mostrarPorFoco = (item, elemento) => {
    const caixa = elemento.getBoundingClientRect();
    const x = Math.min(Math.max(12, caixa.left), window.innerWidth - larguraTooltip - 12);
    const y = Math.min(Math.max(12, caixa.bottom + 8), window.innerHeight - alturaTooltip - 12);
    setTooltip({ item, x, y });
  };

  return (
    <div className={`mt-3 space-y-3 overflow-y-auto pr-1 ${maxAltura}`}>
      {itens.map((item) => (
        <div
          key={item.chave}
          tabIndex={0}
          onMouseEnter={(event) => mostrar(item, event)}
          onMouseLeave={() => setTooltip(null)}
          onFocus={(event) => mostrarPorFoco(item, event.currentTarget)}
          onBlur={() => setTooltip(null)}
          className="group cursor-help rounded-lg px-1 py-0.5 outline-none transition-colors hover:bg-slate-800/50 focus-visible:bg-slate-800/50"
          aria-label={`${item.detalhes.tag}: ${item.rotuloValor} de interdição. Passe o mouse ou foque para ver motivo, datas e impactos.`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] font-semibold text-slate-200">
              {item.rotulo}
              {item.sub && <span className="ml-1.5 font-normal text-slate-500">{item.sub}</span>}
            </span>
            <span className="shrink-0 text-right text-[11px] font-bold tabular-nums" style={{ color: SECOES.interdicao.cor }}>
              {item.rotuloValor}
            </span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-2.5 rounded-full transition-all duration-500 group-hover:brightness-110"
              style={{ width: `${Math.max((item.valor ?? 0) * 100, 4)}%`, background: SECOES.interdicao.cor }}
            />
          </div>
        </div>
      ))}

      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[80] w-[320px] max-w-[calc(100vw-24px)] rounded-xl border border-slate-600 bg-slate-900/95 p-3 shadow-2xl ring-1 ring-black/40 backdrop-blur"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <CorpoTooltipInterdicao detalhes={tooltip.item.detalhes} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View principal
// ---------------------------------------------------------------------------
// Filtro de situacao vazio = MOB + DESMOB (historico completo): veiculos
// desmobilizados com apontamentos no periodo continuam visiveis no BI.
const FILTROS_INICIAIS = { tag: '', modelo: '', contrato: '', situacao: '' };
// Periodo padrao: inicio do historico importado (01/01/2026) ate hoje, para o
// grafico mensal exibir o ano completo (Jan a Out) ao abrir o painel.
const PERIODO_INICIAL = { inicio: '2026-01-01', fim: hojeISO() };

export default function GestaoEficienciaView({ sessao }) {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [periodo, setPeriodo] = useState({ ...PERIODO_INICIAL });
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  const buscar = useCallback(async (signal) => {
    setCarregando(true);
    setErro(null);
    const params = new URLSearchParams();
    if (filtros.tag) params.set('tag', filtros.tag);
    if (filtros.modelo) params.set('modelo', filtros.modelo);
    if (filtros.contrato) params.set('contrato', filtros.contrato);
    params.set('situacao', filtros.situacao || 'TODOS');
    if (periodo.inicio) params.set('dataInicio', periodo.inicio);
    if (periodo.fim) params.set('dataFim', periodo.fim);
    const query = params.toString();
    try {
      const resp = await fetch(`/api/eficiencia?${query}`, { headers: authHeaders(sessao), signal });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo?.message || `Falha ao carregar a eficiência (HTTP ${resp.status}).`);
      setDados(corpo.data);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.error('[eficiencia] Falha ao consultar o dashboard', {
        url: `/api/eficiencia?${query}`,
        erro: e,
      });
      setErro(e?.message || 'Falha ao consultar o dashboard de eficiência.');
    } finally {
      setCarregando(false);
    }
  }, [filtros, periodo, sessao]);

  useEffect(() => {
    const ac = new AbortController();
    buscar(ac.signal);
    return () => ac.abort();
  }, [buscar]);

  const indicadores = dados?.indicadores;
  const totais = indicadores?.totais || {};
  const percentuais = indicadores?.percentuais || {};
  const opcoes = dados?.opcoes;

  const opcoesTag = useMemo(
    () => (opcoes?.tags || []).map((t) => ({ valor: t.tag, rotulo: t.placa ? `${t.tag} · ${t.placa}` : t.tag })),
    [opcoes],
  );
  const opcoesModelo = useMemo(() => (opcoes?.modelos || []).map((m) => ({ valor: m, rotulo: m })), [opcoes]);
  const opcoesContrato = useMemo(() => (opcoes?.contratos || []).map((c) => ({ valor: c, rotulo: c })), [opcoes]);

  const filtrosAtivos =
    Object.entries(filtros).some(([chave, valor]) => valor && valor !== FILTROS_INICIAIS[chave]) ||
    periodo.inicio !== PERIODO_INICIAL.inicio ||
    periodo.fim !== PERIODO_INICIAL.fim;

  const itensPorTag = useMemo(
    () => (dados?.por_tag || []).map((t) => ({
      chave: t.tag,
      rotulo: t.tag,
      sub: t.placa || '',
      valor: t.eficiencia,
      descricao: `Operação ${fmtNum(t.operacao)} · Desvios ${fmtNum(t.desvio)} · Preventiva ${fmtNum(t.preventiva)} · Pendências ${fmtNum(t.pendentes)}`,
      tooltip: `${t.tag} (${t.modelo}) — eficiência ${fmtPct(t.eficiencia)}`,
    })),
    [dados],
  );

  const itensPorModelo = useMemo(
    () => (dados?.por_modelo || []).map((m) => ({
      chave: m.modelo,
      rotulo: m.modelo,
      sub: `(${fmtNum(m.veiculos)} veíc.)`,
      valor: m.eficiencia,
      descricao: `Operação ${fmtNum(m.operacao)} · Desvios ${fmtNum(m.desvio)} · Pendências ${fmtNum(m.pendentes)}`,
      tooltip: `${m.modelo} — eficiência ${fmtPct(m.eficiencia)}`,
    })),
    [dados],
  );

  const itensInterdicao = useMemo(() => {
    const linhas = (dados?.por_tag || [])
      .filter((t) => t.interdicao > 0)
      .sort((a, b) => b.interdicao - a.interdicao);
    const maximo = linhas.reduce((maior, t) => Math.max(maior, t.interdicoes?.dias ?? t.interdicao), 0) || 1;
    return linhas.map((t) => {
      const detalhe = t.interdicoes || {};
      const dias = detalhe.dias ?? t.interdicao;
      return {
        chave: t.tag,
        rotulo: t.tag,
        sub: t.placa || '',
        valor: dias / maximo,
        rotuloValor: `${fmtNum(dias)} ${dias === 1 ? 'dia' : 'dias'}`,
        detalhes: {
          tag: t.tag,
          placa: t.placa,
          modelo: t.modelo,
          contrato: t.contrato,
          status: t.status,
          motivo: detalhe.motivo,
          datas: detalhe.datas || [],
          dias,
          percentualDias: detalhe.percentual_dias_uteis ?? detalhe.percentual_dias_validos,
          desvio: t.desvio,
          eficiencia: t.eficiencia,
        },
      };
    });
  }, [dados]);

  const meses = dados?.por_mes || [];

  return (
    <div className="space-y-5 rounded-2xl bg-slate-950 p-4 shadow-2xl ring-1 ring-slate-800 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-sky-400">Transporte</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            <TrendingUp size={26} className="text-sky-400" />
            Gestão de Eficiência
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Métricas de disponibilidade física, MTBF, MTTR e controle simplificado da frota
          </p>
        </div>
        {dados?.periodo && (
          <div className="text-right text-[11px] text-slate-500">
            <div className="font-semibold text-slate-300">
              {dataBR(dados.periodo.inicio)} — {dataBR(dados.periodo.fim)}
            </div>
            <div>{fmtNum(dados.periodo.dias_uteis)} dias úteis · {fmtNum(indicadores?.veiculos)} veículos no filtro</div>
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <FiltroSelect rotulo="TAG" valor={filtros.tag} onChange={(v) => setFiltros((f) => ({ ...f, tag: v }))} opcoes={opcoesTag} vazio="Todas as TAGs" />
        <FiltroSelect rotulo="Modelo" valor={filtros.modelo} onChange={(v) => setFiltros((f) => ({ ...f, modelo: v }))} opcoes={opcoesModelo} vazio="Todos os modelos" />
        <FiltroSelect rotulo="Contrato" valor={filtros.contrato} onChange={(v) => setFiltros((f) => ({ ...f, contrato: v }))} opcoes={opcoesContrato} vazio="Todos os contratos" />
        <FiltroSelect
          rotulo="MOB / DESMOB"
          valor={filtros.situacao}
          onChange={(v) => setFiltros((f) => ({ ...f, situacao: v }))}
          vazio="MOB + DESMOB (histórico completo)"
          opcoes={[
            { valor: 'MOB', rotulo: 'MOB — mobilizados' },
            { valor: 'DESMOB', rotulo: 'DESMOB — desmobilizados' },
          ]}
        />
        <FiltroData
          rotulo="Data inicial"
          valor={periodo.inicio}
          onChange={(v) => setPeriodo((p) => ({ ...p, inicio: v }))}
          max={periodo.fim || undefined}
        />
        <FiltroData
          rotulo="Data final"
          valor={periodo.fim}
          onChange={(v) => setPeriodo((p) => ({ ...p, fim: v }))}
          min={periodo.inicio || undefined}
        />
        <button
          type="button"
          onClick={() => { setFiltros(FILTROS_INICIAIS); setPeriodo({ ...PERIODO_INICIAL }); }}
          disabled={!filtrosAtivos}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-sky-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FilterX size={14} />
          Limpar Filtros
        </button>
      </div>

      {erro && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle size={16} className="shrink-0" />
            {erro}
          </div>
          <button
            type="button"
            onClick={() => buscar()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-800 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/40"
          >
            <RefreshCw size={13} />
            Tentar novamente
          </button>
        </div>
      )}

      {carregando && !dados ? (
        <EstadoCarregando />
      ) : (
        <div className={'grid grid-cols-1 gap-4 xl:grid-cols-12 ' + (carregando ? 'opacity-60 transition-opacity' : '')}>
          {/* Bloco esquerdo: gauge + eficiência por TAG + por modelo */}
          <div className="min-w-0 space-y-4 xl:col-span-6">
            <Card>
              <TituloCard icone={Gauge} titulo="Eficiência Geral" subtitulo="Prevalece sobre paradas programadas" extra={carregando ? <RefreshCw size={14} className="animate-spin text-slate-500" /> : null} />
              <div className="mt-2">
                <GaugeEficiencia valor={indicadores?.eficiencia} />
              </div>
              <FaixasEficiencia className="mt-2" />
              <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-center">
                <div>
                  <div className="text-sm font-bold tabular-nums text-emerald-400">{fmtNum(totais.operacao)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Operação</div>
                </div>
                <div>
                  <div className="text-sm font-bold tabular-nums text-red-400">{fmtNum(totais.desvio)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Desvios</div>
                </div>
                <div>
                  <div className="text-sm font-bold tabular-nums text-amber-400">{fmtNum(totais.preventiva)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Preventiva</div>
                </div>
              </div>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <TituloCard icone={BarChart3} titulo="Eficiência por TAG" subtitulo="Do menor para o maior aproveitamento" />
                <BarrasHorizontais itens={itensPorTag} />
              </Card>

              <Card>
                <TituloCard icone={Truck} titulo="Eficiência por Modelo" subtitulo="Média ponderada dos veículos do modelo" />
                <BarrasHorizontais itens={itensPorModelo} />
              </Card>
            </div>
          </div>

          {/* Bloco central/direito: KPIs + evolução mensal + interdições */}
          <div className="min-w-0 space-y-4 xl:col-span-6">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
              <KpiCard chave="corretiva" total={totais.corretiva} percentual={percentuais.corretiva} />
              <KpiCard chave="preventiva" total={totais.preventiva} percentual={percentuais.preventiva} />
              <KpiCard chave="interdicao" total={totais.interdicao} percentual={percentuais.interdicao} />
              <KpiCard chave="operacao" total={totais.operacao} percentual={percentuais.operacao} />
              <KpiCard chave="indisponibilidade" total={totais.indisponibilidade} percentual={percentuais.indisponibilidade} />
            </div>

            <Card>
              <TituloCard icone={LayoutGrid} titulo="Eficiência por Mês" subtitulo="Percentual mensal (Operação ÷ Operação + Desvios)" />
              <div className="mt-3 flex gap-2 sm:gap-3">
                {meses.map((m) => (
                  <div key={m.mes} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <span className="text-[10px] font-bold tabular-nums text-slate-300">{fmtPct(m.eficiencia)}</span>
                    <div className="flex h-36 w-full items-end">
                      <div
                        className="w-full rounded-t-md transition-all duration-500"
                        style={{
                          height: `${Math.max((m.eficiencia ?? 0) * 100, m.eficiencia === null ? 2 : 6)}%`,
                          background: m.eficiencia === null
                            ? '#334155'
                            : `linear-gradient(180deg, ${corPorEficiencia(m.eficiencia)}, ${corPorEficiencia(m.eficiencia)}aa)`,
                        }}
                        title={`${m.rotulo}: Operação ${fmtNum(m.operacao)} · Desvios ${fmtNum(m.desvio)} · Preventiva ${fmtNum(m.preventiva)} · Pendências ${fmtNum(m.pendentes)}`}
                      />
                    </div>
                    <span className="w-full truncate text-center text-[10px] font-medium text-slate-500">{m.rotulo}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <TituloCard icone={ShieldAlert} titulo="Interdições de Veículos" subtitulo="Dias em interdição por TAG no período · passe o mouse para ver motivo, datas e impactos" />
              <InterdicoesPainel itens={itensInterdicao} />
            </Card>
          </div>
        </div>
      )}

      {/* Secao inferior: Matriz Calendario — analise mensal dia a dia por veiculo,
          com apontamento rapido na celula e exportacao em PDF.
          IMPORTANTE: os filtros globais da secao superior nao sao repassados —
          a matriz tem seletor de mes/ano proprio e e totalmente independente. */}
      <MatrizCalendarioMensal
        sessao={sessao}
        onAtualizado={() => buscar()}
      />
    </div>
  );
}
