import { useEffect, useMemo, useState } from 'react';
import { Gauge, Search, RefreshCw, Wrench, Loader2, AlertTriangle } from 'lucide-react';

// ============================================================================
// Gestão Preditiva de Preventivas — Gantt da frota ativa.
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
  critico: { rotulo: 'Crítico / vencido', chip: 'bg-red-100 text-red-700 ring-red-600/20', barra: 'bg-red-500' },
  atencao: { rotulo: 'Próximo (5–15 dias)', chip: 'bg-amber-100 text-amber-800 ring-amber-600/20', barra: 'bg-amber-400' },
  ok: { rotulo: 'Folga segura (>15 dias)', chip: 'bg-green-100 text-green-700 ring-green-600/20', barra: 'bg-green-500' },
  sem_dados: { rotulo: 'Sem histórico', chip: 'bg-omega-100 text-omega-500 ring-omega-700/10', barra: 'bg-omega-200' },
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
      <div className="relative h-6 rounded-lg bg-omega-100 overflow-hidden">
        {[15, 30].map((m) => (
          <span key={m} className="absolute top-0 bottom-0 w-px bg-omega-300/70" style={{ left: `${(m / JANELA_DIAS) * 100}%` }} />
        ))}
        {faixa === 'sem_dados' ? (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-omega-400">
            sem histórico de KM
          </span>
        ) : (
          <span
            className={`absolute left-0 top-0 bottom-0 rounded-lg ${FAIXAS[faixa].barra} ${vencido ? 'w-full opacity-90' : ''}`}
            style={vencido ? undefined : { width: `${Math.max(largura, 3)}%` }}
          />
        )}
        <span className="absolute left-1 top-0 bottom-0 w-0.5 bg-omega-900/60 rounded" title="Hoje" />
      </div>
      <div className="relative h-4 text-[9px] text-omega-400 font-medium tabular-nums">
        <span className="absolute left-0">Hoje</span>
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
    { key: 'sem_dados', label: 'Sem dados' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="p-2 rounded-xl bg-omega-900 text-white"><Gauge size={18} /></span>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-omega-900 leading-tight">Gestão Preditiva de Preventivas</h2>
          <p className="text-xs text-omega-500">Média diária (30 dias úteis; estimada quando não há histórico) • projeção em dias corridos • janela do Gantt: {JANELA_DIAS} dias</p>
        </div>
        <button onClick={carregar} disabled={carregando} className="btn-secondary ml-auto !py-2 text-xs disabled:opacity-50">
          <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '🔴 Críticos / vencidos', valor: resumo.critico, cls: 'text-red-600' },
          { label: '🟡 Próximos (5–15d)', valor: resumo.atencao, cls: 'text-amber-600' },
          { label: '🟢 Folga segura', valor: resumo.ok, cls: 'text-green-600' },
          { label: 'Sem histórico', valor: resumo.sem_dados, cls: 'text-omega-400' },
        ].map((c) => (
          <div key={c.label} className="card p-3">
            <div className={`text-2xl font-extrabold tabular-nums ${c.cls}`}>{c.valor}</div>
            <div className="text-[11px] font-semibold text-omega-500">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="card p-3 flex flex-col md:flex-row gap-2 md:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-omega-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} className="input !pl-8 !py-2 text-sm" placeholder="Buscar TAG, placa ou modelo..." />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${filtro === f.key ? 'bg-omega-900 text-white' : 'bg-omega-100 text-omega-600 hover:bg-omega-200'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="card p-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border-red-200">
          <AlertTriangle size={16} /> {erro}
        </div>
      )}
      {carregando && (
        <div className="card p-8 flex items-center justify-center gap-2 text-sm text-omega-500">
          <Loader2 size={16} className="animate-spin" /> Calculando projeções da frota...
        </div>
      )}

      {!carregando && !erro && visiveis.length === 0 && (
        <div className="card p-8 text-center text-sm text-omega-400 italic">Nenhum veículo corresponde ao filtro.</div>
      )}

      <div className="space-y-3">
        {visiveis.map((l) => {
          const faixa = faixaDe(l);
          const dias = l.dias_restantes_estimados;
          return (
            <div key={l.tag} className="card p-3 md:p-4">
              <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_210px] gap-3 items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-extrabold text-omega-900 text-sm">{l.tag}</span>
                    <span className={`chip ring-1 ring-inset text-[10px] ${FAIXAS[faixa].chip}`}>{FAIXAS[faixa].rotulo}</span>
                  </div>
                  <div className="text-[11px] text-omega-500 truncate">{l.modelo || 'Modelo não informado'}{l.placa ? ` • ${l.placa}` : ''}</div>
                  <div
                    className="text-[11px] text-omega-500 tabular-nums"
                    title={l.media_estimada
                      ? `Sem histórico suficiente: média estimada pela ${l.origem_media === 'frota_modelo' ? 'frota do mesmo modelo' : 'categoria do veículo'}`
                      : 'Média calculada com as leituras dos últimos 30 dias'}
                  >
                    Média: <strong className="text-omega-800">{fmtMedia(l.media_km_dia)}</strong>
                    {l.media_estimada ? <span className="text-omega-400"> (estimada)</span> : null}
                    {' • '}Restam: <strong className="text-omega-800">{fmtKm(l.km_restantes)} km</strong>
                  </div>
                </div>
                <BarraGantt linha={l} />
                <div className="flex lg:flex-col items-center lg:items-end gap-2 justify-between">
                  <div className="text-left lg:text-right">
                    <div className="text-[11px] text-omega-500">Parada estimada</div>
                    <div className="text-sm font-extrabold text-omega-900 tabular-nums">
                      {dias === null || dias === undefined ? '—' : dias <= 0 ? 'VENCIDA' : `${dias}d • ${fmtData(l.data_prevista_preventiva)}`}
                    </div>
                  </div>
                  <button
                    onClick={() => registrarPreventiva(l)}
                    disabled={registrando === l.tag || l.km_atual === null || l.km_atual === undefined}
                    title={l.km_atual === null || l.km_atual === undefined ? 'Sem leitura de KM para registrar' : `Registrar preventiva em ${fmtKm(l.km_atual)} km`}
                    className="btn-secondary !py-1.5 !px-2.5 text-xs disabled:opacity-40 shrink-0"
                  >
                    {registrando === l.tag ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
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
