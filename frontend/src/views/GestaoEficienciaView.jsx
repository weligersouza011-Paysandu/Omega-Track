import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
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
// pendencias), gauge de eficiencia geral, barras por TAG e por modelo, evolucao
// mensal, interdições por veiculo e calendario mensal de paradas.
// ============================================================================

const SECOES = {
  operacao: { rotulo: 'Operação', cor: '#34d399', classe: 'text-emerald-400' },
  corretiva: { rotulo: 'Manutenção Corretiva', curto: 'Corretiva', cor: '#f87171', classe: 'text-red-400' },
  preventiva: { rotulo: 'Manutenção Preventiva', curto: 'Preventiva', cor: '#fbbf24', classe: 'text-amber-400' },
  interdicao: { rotulo: 'Interdição', curto: 'Interdição', cor: '#fb923c', classe: 'text-orange-400' },
  indisponibilidade: { rotulo: 'Indisponibilidade', curto: 'Indisp.', cor: '#a78bfa', classe: 'text-violet-400' },
  pendentes: { rotulo: 'Pendências', curto: 'Pendências', cor: '#60a5fa', classe: 'text-sky-400' },
};

const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const TIPOS_CALENDARIO = ['corretiva', 'preventiva', 'interdicao', 'indisponibilidade'];

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const fmtNum = (n) => Number(n || 0).toLocaleString('pt-BR');
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

function corPorEficiencia(v) {
  if (v === null || v === undefined) return '#475569';
  if (v >= 0.8) return '#34d399';
  if (v >= 0.5) return '#fbbf24';
  return '#f87171';
}

function rotuloMesLongo(ym) {
  const [ano, mes] = String(ym).split('-').map(Number);
  return `${MESES_LONGOS[(mes || 1) - 1]} ${ano}`;
}

function somarMes(ym, delta) {
  let [ano, mes] = String(ym).split('-').map(Number);
  mes += delta;
  if (mes > 12) { mes = 1; ano += 1; }
  if (mes < 1) { mes = 12; ano -= 1; }
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Componentes de apoio
// ---------------------------------------------------------------------------
function Card({ children, className = '' }) {
  return <section className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg ${className}`}>{children}</section>;
}

function TituloCard({ icone: Icone, titulo, subtitulo, extra }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icone size={17} className="shrink-0 text-sky-400" />
        <div>
          <h2 className="text-sm font-bold text-slate-100">{titulo}</h2>
          {subtitulo && <p className="text-[11px] text-slate-500">{subtitulo}</p>}
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

// Gauge semicircular com ponteiro (SVG puro).
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
        <path d={arco(0.005, 0.492)} stroke="#ef4444" strokeWidth="15" strokeLinecap="round" fill="none" opacity="0.85" />
        <path d={arco(0.508, 0.792)} stroke="#f59e0b" strokeWidth="15" strokeLinecap="round" fill="none" opacity="0.85" />
        <path d={arco(0.808, 0.995)} stroke="#10b981" strokeWidth="15" strokeLinecap="round" fill="none" opacity="0.85" />
        <g transform={`rotate(${angulo} ${cx} ${cy})`}>
          <polygon points={`${cx - 4},${cy} ${cx + 4},${cy} ${cx},${cy - r + 26}`} fill="#e2e8f0" />
        </g>
        <circle cx={cx} cy={cy} r="9" fill="#0f172a" stroke="#e2e8f0" strokeWidth="3" />
      </svg>
      <div className="-mt-3 text-center">
        <div className="text-4xl font-extrabold tabular-nums tracking-tight text-white">
          {temValor ? e.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
        <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Eficiência Geral</div>
        <div className="mt-0.5 text-[10px] text-slate-500">Operação ÷ (Operação + Desvios)</div>
      </div>
    </div>
  );
}

// Barras horizontais genéricas (TAG / Modelo / Interdições).
function BarrasHorizontais({ itens, maxAltura = 'max-h-72', descricaoValor, corDe = corPorEficiencia }) {
  if (!itens.length) {
    return <p className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-center text-xs text-slate-500">Sem dados no período.</p>;
  }
  return (
    <div className={`mt-3 space-y-2.5 overflow-y-auto pr-1 ${maxAltura}`}>
      {itens.map((item) => {
        const cor = corDe(item.valor);
        return (
          <div key={item.chave} title={item.tooltip}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-semibold text-slate-200">
                {item.rotulo}
                {item.sub && <span className="ml-1.5 font-normal text-slate-500">{item.sub}</span>}
              </span>
              <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: cor }}>
                {item.rotuloValor ?? fmtPct(item.valor)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-2 rounded-full transition-all duration-500"
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
    pendentes: AlertTriangle,
  }[chave];
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 p-3">
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: cfg.cor }} />
      <div className="flex items-center gap-1.5">
        <Icone size={13} style={{ color: cfg.cor }} />
        <span className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">{cfg.curto}</span>
      </div>
      <div className="mt-2 text-2xl font-extrabold tabular-nums text-white">{fmtPct(percentual)}</div>
      <div className="text-[11px] text-slate-400">{fmtNum(total)} {total === 1 ? 'dia' : 'dias'}</div>
    </div>
  );
}

function EstadoCarregando() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-2xl bg-slate-900" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="h-96 animate-pulse rounded-2xl bg-slate-900 xl:col-span-5" />
        <div className="h-96 animate-pulse rounded-2xl bg-slate-900 xl:col-span-7" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendário mensal de paradas
// ---------------------------------------------------------------------------
function CalendarioParadas({ calendario, periodo, filtro, setFiltro }) {
  const mesInicio = periodo?.inicio?.slice(0, 7) || null;
  const mesFim = periodo?.fim?.slice(0, 7) || null;
  const [mes, setMes] = useState(() => mesFim || mesInicio);

  useEffect(() => {
    if (mesFim && (!mes || mes > mesFim || mes < mesInicio)) setMes(mesFim);
  }, [mesInicio, mesFim]); // eslint-disable-line react-hooks/exhaustive-deps

  const porDia = useMemo(() => {
    const mapa = new Map();
    for (const dia of calendario || []) mapa.set(dia.data, dia);
    return mapa;
  }, [calendario]);

  if (!mesInicio || !mesFim) return null;

  const [ano, mesNum] = mes.split('-').map(Number);
  const primeiroDiaSemana = (new Date(Date.UTC(ano, mesNum - 1, 1)).getUTCDay() + 6) % 7; // segunda = 0
  const diasNoMes = new Date(Date.UTC(ano, mesNum, 0)).getUTCDate();
  const celulas = [
    ...Array.from({ length: primeiroDiaSemana }, () => null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ];

  const tiposVisiveis = filtro === 'todas' ? TIPOS_CALENDARIO : [filtro];
  const podeVoltar = mes > mesInicio;
  const podeAvancar = mes < mesFim;

  return (
    <Card>
      <TituloCard
        icone={CalendarDays}
        titulo="Calendário de Paradas"
        subtitulo="Veículos em manutenção ou interdição por dia"
        extra={
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-200 outline-none focus:border-sky-500"
          >
            <option value="todas">Todas as paradas</option>
            {TIPOS_CALENDARIO.map((t) => (
              <option key={t} value={t}>{SECOES[t].rotulo}</option>
            ))}
          </select>
        }
      />

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          disabled={!podeVoltar}
          onClick={() => setMes((m) => somarMes(m, -1))}
          className="rounded-lg border border-slate-700 p-1.5 text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-bold text-slate-100">{rotuloMesLongo(mes)}</span>
        <button
          type="button"
          disabled={!podeAvancar}
          onClick={() => setMes((m) => somarMes(m, 1))}
          className="rounded-lg border border-slate-700 p-1.5 text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">{d}</div>
        ))}
        {celulas.map((dia, indice) => {
          if (dia === null) return <div key={`vazio-${indice}`} />;
          const iso = `${mes}-${String(dia).padStart(2, '0')}`;
          const registro = porDia.get(iso);
          const chips = tiposVisiveis
            .map((t) => ({ tipo: t, qtd: registro?.[t] || 0, veiculos: registro?.veiculos?.[t] || [] }))
            .filter((c) => c.qtd > 0);
          const tooltip = chips.length
            ? chips.map((c) => `${SECOES[c.tipo].rotulo}: ${c.veiculos.map((v) => v.tag).join(', ')}`).join('\n')
            : undefined;
          return (
            <div
              key={iso}
              title={tooltip}
              className={
                'min-h-[52px] rounded-lg border p-1.5 transition-colors ' +
                (chips.length ? 'border-slate-700 bg-slate-900' : 'border-slate-800/60 bg-slate-900/30')
              }
            >
              <div className={'text-[11px] font-semibold tabular-nums ' + (chips.length ? 'text-slate-200' : 'text-slate-600')}>
                {dia}
              </div>
              <div className="mt-1 flex flex-wrap gap-0.5">
                {chips.map((c) => (
                  <span
                    key={c.tipo}
                    className="rounded px-1 text-[9px] font-bold tabular-nums"
                    style={{ background: `${SECOES[c.tipo].cor}26`, color: SECOES[c.tipo].cor }}
                  >
                    {c.qtd}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-800 pt-3">
        {TIPOS_CALENDARIO.map((t) => (
          <span key={t} className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ background: SECOES[t].cor }} />
            {SECOES[t].rotulo}
          </span>
        ))}
      </div>
    </Card>
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
  const [filtroCalendario, setFiltroCalendario] = useState('todas');

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
    const linhas = (dados?.por_tag || []).filter((t) => t.interdicao > 0).sort((a, b) => b.interdicao - a.interdicao);
    const maximo = linhas.length ? linhas[0].interdicao : 1;
    return linhas.map((t) => ({
      chave: t.tag,
      rotulo: t.tag,
      sub: t.placa || '',
      valor: t.interdicao / maximo,
      rotuloValor: `${fmtNum(t.interdicao)} ${t.interdicao === 1 ? 'dia' : 'dias'}`,
      tooltip: `${t.tag} — ${fmtNum(t.interdicao)} dia(s) de interdição`,
    }));
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
          <div className="space-y-4 xl:col-span-5">
            <Card>
              <TituloCard icone={Gauge} titulo="Eficiência Geral" subtitulo="Prevalece sobre paradas programadas" extra={carregando ? <RefreshCw size={14} className="animate-spin text-slate-500" /> : null} />
              <div className="mt-2">
                <GaugeEficiencia valor={indicadores?.eficiencia} />
              </div>
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

            <Card>
              <TituloCard icone={BarChart3} titulo="Eficiência por TAG" subtitulo="Do menor para o maior aproveitamento" />
              <BarrasHorizontais itens={itensPorTag} />
            </Card>

            <Card>
              <TituloCard icone={Truck} titulo="Eficiência por Modelo" subtitulo="Média ponderada dos veículos do modelo" />
              <BarrasHorizontais itens={itensPorModelo} />
            </Card>
          </div>

          {/* Bloco central/direito: KPIs + evolução mensal + interdições + calendário */}
          <div className="space-y-4 xl:col-span-7">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <KpiCard chave="corretiva" total={totais.corretiva} percentual={percentuais.corretiva} />
              <KpiCard chave="preventiva" total={totais.preventiva} percentual={percentuais.preventiva} />
              <KpiCard chave="interdicao" total={totais.interdicao} percentual={percentuais.interdicao} />
              <KpiCard chave="operacao" total={totais.operacao} percentual={percentuais.operacao} />
              <KpiCard chave="pendentes" total={totais.pendentes} percentual={percentuais.pendentes} />
            </div>

            <Card>
              <TituloCard icone={LayoutGrid} titulo="Eficiência por Mês" subtitulo="Percentual mensal (Operação ÷ Operação + Desvios)" />
              <div className="mt-4 flex gap-2 sm:gap-3">
                {meses.map((m) => (
                  <div key={m.mes} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <span className="text-[10px] font-bold tabular-nums text-slate-300">{fmtPct(m.eficiencia)}</span>
                    <div className="flex h-40 w-full items-end">
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
              <TituloCard icone={ShieldAlert} titulo="Interdições de Veículos" subtitulo="Dias em interdição por TAG no período" />
              <BarrasHorizontais itens={itensInterdicao} corDe={() => SECOES.interdicao.cor} maxAltura="max-h-56" />
            </Card>

            <CalendarioParadas
              calendario={dados?.calendario || []}
              periodo={dados?.periodo}
              filtro={filtroCalendario}
              setFiltro={setFiltroCalendario}
            />
          </div>
        </div>
      )}

      {/* Secao inferior: Matriz Calendario — analise mensal dia a dia por veiculo,
          com apontamento rapido na celula e exportacao em PDF. */}
      <MatrizCalendarioMensal
        sessao={sessao}
        filtros={filtros}
        onAtualizado={() => buscar()}
      />
    </div>
  );
}
