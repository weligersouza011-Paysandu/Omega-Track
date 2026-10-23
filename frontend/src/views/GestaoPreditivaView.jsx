import { useEffect, useMemo, useState } from 'react';
import { Gauge, Search, RefreshCw, Wrench, Loader2, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

// ============================================================================
// Gestão Preditiva de Preventivas — Gantt da frota ativa (Tema Dark Industrial).
// Faixas: 🟢 folga (>15 dias) • 🟡 próximo (5–15 dias) • 🔴 vencido/<5 dias.
// ============================================================================

const JANELA_DIAS = 45;

function faixaDe(linha) {
  if (linha.dias_restantes_estimados === null || linha.dias_restantes_estimados === undefined) return 'sem_dados';
  if ((linha.km_restantes ?? 1) <= 0 || linha.dias_restantes_estimados < 5) return 'critico';
  if (linha.dias_restantes_estimados <= 15) return 'atencao';
  return 'ok';
}

const FAIXAS = {
  critico: {
    rotulo: 'Crítico / vencido',
    chip: 'bg-rose-500/15 text-rose-300 border border-rose-500/30',
    barra: 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]',
  },
  atencao: {
    rotulo: 'Próximo (5–15 dias)',
    chip: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    barra: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.4)]',
  },
  ok: {
    rotulo: 'Folga segura (>15 dias)',
    chip: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    barra: 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]',
  },
  sem_dados: {
    rotulo: 'Sem histórico',
    chip: 'bg-slate-800/80 text-slate-400 border border-slate-700/60',
    barra: 'bg-slate-700',
  },
};

const fmtKm = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR'));
const fmtMedia = (v) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km/dia`);
function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}
function isoDaquiADias(dias) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(dias || 0, 0));
  return d.toISOString().slice(0, 10);
}

function BarraGantt({ linha }) {
  const faixa = faixaDe(linha);
  const dias = linha.dias_restantes_estimados;
  const largura = dias === null || dias === undefined ? 0 : Math.min(Math.max(dias, 0) / JANELA_DIAS, 1) * 100;
  const vencido = (linha.km_restantes ?? 1) <= 0;
  return (
    <div>
      <div className="relative h-6 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden shadow-inner">
        {[15, 30].map((m) => (
          <span
            key={m}
            className="absolute top-0 bottom-0 w-px bg-slate-700/60 z-10"
            style={{ left: `${(m / JANELA_DIAS) * 100}%` }}
          />
        ))}
        {faixa === 'sem_dados' ? (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-500 tracking-wide">
            sem histórico de KM
          </span>
        ) : (
          <span
            className={`absolute left-0 top-0 bottom-0 rounded-lg transition-all duration-300 ${FAIXAS[faixa].barra} ${
              vencido ? 'w-full opacity-90' : ''
            }`}
            style={vencido ? undefined : { width: `${Math.max(largura, 3)}%` }}
          />
        )}
        <span
          className="absolute left-1 top-0 bottom-0 w-1 bg-sky-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.8)] z-20"
          title="Hoje"
        />
      </div>
      <div className="relative h-4 text-[9px] text-slate-400 font-semibold tabular-nums mt-1">
        <span className="absolute left-0 text-sky-400 font-bold">Hoje</span>
        <span className="absolute" style={{ left: '33%' }}>15d</span>
        <span className="absolute" style={{ left: '66%' }}>30d</span>
        <span className="absolute right-0">45d+</span>
      </div>
    </div>
  );
}

export default function GestaoPreditivaView() {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [registrando, setRegistrando] = useState(null);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch(`/api/manutencao/projecao-frota?_t=${Date.now()}`, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`API respondeu ${resp.status}`);
      const corpo = await resp.json();
      setLinhas(Array.isArray(corpo?.data) ? corpo.data : []);
    } catch (e) {
      setErro('Não foi possível carregar a projeção. Verifique se o backend está no ar.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const registrarPreventiva = async (linha) => {
    if (linha.km_atual === null || linha.km_atual === undefined) return;
    const ok = window.confirm(
      `Registrar preventiva de ${linha.tag} em ${fmtKm(linha.km_atual)} km? O acumulado desde a última preventiva será zerado.`
    );
    if (!ok) return;
    setRegistrando(linha.tag);
    try {
      const resp = await fetch(`/api/mob-desmob/${encodeURIComponent(linha.tag)}/preventiva`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ km: linha.km_atual }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `API respondeu ${resp.status}`);
      // Atualização imediata da linha: o KM da preventiva vira o novo marco
      // zero e o ciclo recomeça com o plano total (barra verde cheia).
      setLinhas((prev) => prev.map((l) => {
        if (l.tag !== linha.tag) return l;
        const limite = Number(l.km_limite_preventiva) || 10000;
        const media = Number(l.media_km_dia);
        const dias = media > 0 ? Math.ceil(limite / media) : null;
        return {
          ...l,
          km_ultima_preventiva: linha.km_atual,
          origem_preventiva: 'registro_manual',
          km_rodados_desde_preventiva: 0,
          km_restantes: limite,
          dias_restantes_estimados: dias,
          data_prevista_preventiva: dias === null ? null : isoDaquiADias(dias),
          status_alerta: 'NORMAL',
          sem_registro_preventiva: false,
        };
      }));
      await carregar();
    } catch (e) {
      alert(e.message || 'Falha ao registrar preventiva.');
    } finally {
      setRegistrando(null);
    }
  };

  const resumo = useMemo(() => {
    const r = { critico: 0, atencao: 0, ok: 0, sem_dados: 0 };
    linhas.forEach((l) => { r[faixaDe(l)] += 1; });
    return r;
  }, [linhas]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return linhas.filter((l) => {
      if (filtro !== 'todos' && faixaDe(l) !== filtro) return false;
      if (!q) return true;
      return (
        String(l.tag || '').toUpperCase().includes(q) ||
        String(l.placa || '').toUpperCase().includes(q) ||
        String(l.modelo || '').toUpperCase().includes(q)
      );
    });
  }, [linhas, busca, filtro]);

  const FILTROS = [
    { key: 'todos', label: 'Todos' },
    { key: 'critico', label: '🔴 Críticos' },
    { key: 'atencao', label: '🟡 Próximos' },
    { key: 'ok', label: '🟢 Em dia' },
    { key: 'sem_dados', label: 'Sem histórico' },
  ];

  return (
    <div className="space-y-5 rounded-2xl bg-slate-950 p-4 sm:p-6 shadow-2xl ring-1 ring-slate-800 text-slate-100">
      {/* Cabeçalho Dark Industrial */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-sky-400">
            Frota & Manutenção Industrial
          </div>
          <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            <span className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-sky-400 shadow-sm">
              <Gauge size={24} />
            </span>
            Gestão Preditiva de Preventivas
          </h1>
          <p className="mt-1.5 text-sm text-slate-400 max-w-3xl">
            Gantt preditivo baseado na média móvel de KM (30 dias úteis) com projeção de paradas e janela de {JANELA_DIAS} dias.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={carregar}
            disabled={carregando}
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 transition-all hover:border-sky-500 hover:bg-slate-800 hover:text-white disabled:opacity-40 shadow-sm"
          >
            <RefreshCw size={14} className={carregando ? 'animate-spin text-sky-400' : 'text-slate-400'} />
            Atualizar dados
          </button>
        </div>
      </header>

      {/* Cards de Métricas e Faixas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {[
          { label: '🔴 Críticos / vencidos', valor: resumo.critico, corValor: 'text-rose-400', borda: 'border-rose-900/40' },
          { label: '🟡 Próximos (5–15d)', valor: resumo.atencao, corValor: 'text-amber-400', borda: 'border-amber-900/40' },
          { label: '🟢 Folga segura (>15d)', valor: resumo.ok, corValor: 'text-emerald-400', borda: 'border-emerald-900/40' },
          { label: '⚪ Sem histórico', valor: resumo.sem_dados, corValor: 'text-slate-400', borda: 'border-slate-800' },
        ].map((c) => (
          <div
            key={c.label}
            className={`rounded-2xl border ${c.borda} bg-slate-900/70 p-4 shadow-lg backdrop-blur transition-all hover:border-slate-700`}
          >
            <div className={`text-3xl font-black tabular-nums tracking-tight ${c.corValor}`}>{c.valor}</div>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur shadow-lg flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 pl-9 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all"
            placeholder="Buscar por TAG, placa ou modelo do veículo..."
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                filtro === f.key
                  ? 'bg-sky-500 text-slate-950 font-black shadow-md shadow-sky-500/20'
                  : 'bg-slate-800/80 border border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Estados: Erro, Carregando e Vazio */}
      {erro && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-300 shadow-lg">
          <AlertTriangle size={18} className="shrink-0 text-rose-400" /> {erro}
        </div>
      )}
      {carregando && (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-sm text-slate-400 shadow-lg">
          <Loader2 size={18} className="animate-spin text-sky-400" /> Calculando projeções analíticas da frota...
        </div>
      )}
      {!carregando && !erro && visiveis.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center text-sm text-slate-400 italic shadow-lg">
          Nenhum veículo corresponde aos filtros selecionados.
        </div>
      )}

      {/* Lista de Veículos no Gantt Dark */}
      <div className="space-y-3">
        {visiveis.map((l) => {
          const faixa = faixaDe(l);
          const dias = l.dias_restantes_estimados;
          return (
            <div
              key={l.tag}
              className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 shadow-md transition-all hover:border-slate-700/90 hover:bg-slate-900/80"
            >
              <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr_220px] gap-4 items-center">
                {/* Metadados do Veículo */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-black text-white text-base tracking-wide">{l.tag}</span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${FAIXAS[faixa].chip}`}>
                      {FAIXAS[faixa].rotulo}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 truncate mt-0.5">
                    {l.modelo || 'Modelo não informado'}
                    {l.placa ? <span className="text-slate-500 font-mono"> • {l.placa}</span> : ''}
                  </div>
                  <div
                    className="text-xs text-slate-400 tabular-nums mt-1 leading-snug"
                    title={
                      l.media_estimada
                        ? `Sem histórico suficiente: média estimada pela ${
                            l.origem_media === 'frota_modelo' ? 'frota do mesmo modelo' : 'categoria do veículo'
                          }`
                        : 'Média calculada com as leituras dos últimos 30 dias úteis'
                    }
                  >
                    Média: <strong className="text-slate-200 font-semibold">{fmtMedia(l.media_km_dia)}</strong>
                    {l.media_estimada ? <span className="text-slate-500 text-[10px]"> (estimada)</span> : null}
                    <span className="text-slate-600 mx-1">·</span>
                    Restam: <strong className="text-slate-200 font-semibold">{fmtKm(l.km_restantes)} km</strong>
                  </div>
                </div>

                {/* Barra do Gantt */}
                <BarraGantt linha={l} />

                {/* Previsão de Parada e Ação */}
                <div className="flex lg:flex-col items-center lg:items-end gap-2.5 justify-between">
                  <div className="text-left lg:text-right">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Parada estimada</div>
                    <div
                      className={`text-sm font-black tabular-nums tracking-tight ${
                        dias === null || dias === undefined
                          ? 'text-slate-400'
                          : dias <= 0
                          ? 'text-rose-400 animate-pulse'
                          : dias <= 15
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {dias === null || dias === undefined
                        ? '—'
                        : dias <= 0
                        ? 'VENCIDA'
                        : `${dias}d • ${fmtData(l.data_prevista_preventiva)}`}
                    </div>
                  </div>
                  <button
                    onClick={() => registrarPreventiva(l)}
                    disabled={registrando === l.tag || l.km_atual === null || l.km_atual === undefined}
                    title={
                      l.km_atual === null || l.km_atual === undefined
                        ? 'Sem leitura de KM para registrar'
                        : `Registrar preventiva em ${fmtKm(l.km_atual)} km`
                    }
                    className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 transition-all hover:border-emerald-500/60 hover:bg-emerald-500 hover:text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-sm"
                  >
                    {registrando === l.tag ? (
                      <Loader2 size={13} className="animate-spin text-emerald-400" />
                    ) : (
                      <Wrench size={13} />
                    )}
                    Registrar preventiva
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
