import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, AlertTriangle, Clock, CheckCircle2, FileWarning, FileText } from 'lucide-react';
import { veiculos } from '../data/mockData.js';
import { calcularFarol, textoDias, FAROL_LABEL, FAROL_LABEL_CURTO, FAROL_COR } from '../utils/farol.js';

const CORES_STATUS = { mob: '#0052CC', desmob: '#A53030' };

// Segmentação por contrato (gráfico de modelos): Eletromecânica marrom/laranja,
// Serra Leste cinza, demais contratos caem na paleta extra.
const CORES_CONTRATO = {
  'Eletromecânica': '#B45309',
  'Serra Leste': '#6B7280',
  'Sondagem': '#0E7490',
};
const PALETA_EXTRA = ['#7C3AED', '#0D9488', '#BE123C', '#4D7C0F', '#1D4ED8', '#A16207'];

function normalizarContrato(raw) {
  const t = String(raw || '').trim();
  if (t === '') return 'Sem contrato';
  const lower = t.toLowerCase();
  if (lower.startsWith('eletromec')) return 'Eletromecânica';
  if (lower.startsWith('serra leste')) return 'Serra Leste';
  if (lower.startsWith('sondag') || lower.startsWith('sondagem')) return 'Sondagem';
  return t;
}

function normalizarModelo(raw) {
  const t = String(raw || '').trim();
  return t === '' ? 'Sem modelo' : t;
}

function formataData(valor) {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function corDoContrato(nome) {
  if (CORES_CONTRATO[nome]) return CORES_CONTRATO[nome];
  let h = 0;
  for (let i = 0; i < nome.length; i += 1) h = (h * 31 + nome.charCodeAt(i)) % 997;
  return PALETA_EXTRA[h % PALETA_EXTRA.length];
}

export default function DashboardExecutivoView() {
  const powerBiUrl = import.meta.env.VITE_POWER_BI_URL || '';

  // Frota real do Neon via API (mesma fonte da galeria); fallback para mock local.
  // Documentos reais do Neon — alimentam o farol de vencimentos em tempo real.
  const [frota, setFrota] = useState([]);
  const [docsNeon, setDocsNeon] = useState([]);
  const [carregandoFrota, setCarregandoFrota] = useState(true);
  useEffect(() => {
    let ativo = true;
    Promise.all([
      fetch('/api/mob-desmob?limit=200')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`API ${r.status}`))))
        .then(({ data }) => { if (ativo && Array.isArray(data)) setFrota(data); })
        .catch(() => {}),
      fetch('/api/documentacao-veiculos?limit=500')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`API ${r.status}`))))
        .then(({ data }) => { if (ativo && Array.isArray(data)) setDocsNeon(data); })
        .catch(() => {}),
    ]).finally(() => { if (ativo) setCarregandoFrota(false); });
    return () => { ativo = false; };
  }, []);
  const base = frota.length > 0 ? frota : veiculos;
  const semDados = !carregandoFrota && base.length === 0;

  // Gráfico 1 — Mobilizados (ativos) por contrato. Desmobilizados ignorados.
  const mobPorContrato = useMemo(() => {
    const mapa = new Map();
    base
      .filter((v) => v.status === 'Mobilizado')
      .forEach((v) => {
        const c = normalizarContrato(v.contrato);
        mapa.set(c, (mapa.get(c) || 0) + 1);
      });
    return [...mapa.entries()]
      .map(([contrato, total]) => ({ contrato, total }))
      .sort((a, b) => b.total - a.total || a.contrato.localeCompare(b.contrato, 'pt-BR'));
  }, [base]);

  const maxMobContrato = useMemo(() => {
    return Math.max(...mobPorContrato.map((v) => v.total), 1);
  }, [mobPorContrato]);

  // Gráfico 2 — Modelos EXCLUSIVAMENTE mobilizados, segmentados por contrato.
  const modelosMobilizados = useMemo(() => {
    const porModelo = new Map();
    base
      .filter((v) => v.status === 'Mobilizado')
      .forEach((v) => {
        const m = normalizarModelo(v.modelo || v.categoria);
        const c = normalizarContrato(v.contrato);
        if (!porModelo.has(m)) porModelo.set(m, new Map());
        const seg = porModelo.get(m);
        seg.set(c, (seg.get(c) || 0) + 1);
      });
    return [...porModelo.entries()]
      .map(([modelo, seg]) => {
        const segmentos = [...seg.entries()]
          .map(([contrato, n]) => ({ contrato, n, cor: corDoContrato(contrato) }))
          .sort((a, b) => b.n - a.n || a.contrato.localeCompare(b.contrato, 'pt-BR'));
        return { modelo, segmentos, total: segmentos.reduce((acc, s) => acc + s.n, 0) };
      })
      .sort((a, b) => b.total - a.total || a.modelo.localeCompare(b.modelo, 'pt-BR'));
  }, [base]);

  const totalMobilizados = useMemo(() => {
    return modelosMobilizados.reduce((acc, m) => acc + m.total, 0);
  }, [modelosMobilizados]);

  const maxModeloMob = useMemo(() => {
    return Math.max(...modelosMobilizados.map((m) => m.total), 1);
  }, [modelosMobilizados]);

  const contratosNosMobilizados = useMemo(() => {
    const s = new Set();
    modelosMobilizados.forEach((m) => m.segmentos.forEach((seg) => s.add(seg.contrato)));
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [modelosMobilizados]);

  const modeloPorTag = useMemo(() => {
    const m = new Map();
    base.forEach((v) => m.set(v.tag, normalizarModelo(v.modelo || v.categoria)));
    return m;
  }, [base]);

  const placaPorTag = useMemo(() => {
    const m = new Map();
    base.forEach((v) => m.set(v.tag, v.placa));
    return m;
  }, [base]);

  // Documentos enriquecidos para as tooltips: farol + modelo/placa resolvidos.
  const docsDetalhados = useMemo(() => docsNeon.map((d) => {
    const f = calcularFarol(d.validade);
    return {
      ...d,
      farol: f.farol,
      dias: f.dias,
      modeloNorm: normalizarModelo(d.veiculo?.modelo || modeloPorTag.get(d.tag)),
      placa: d.veiculo?.placa || placaPorTag.get(d.tag) || '—',
    };
  }), [docsNeon, modeloPorTag, placaPorTag]);

  const docsPorStatus = (k) => docsDetalhados.filter((d) => d.farol === k);
  const docsPorModeloStatus = (modelo, k) =>
    docsDetalhados.filter((d) => d.modeloNorm === modelo && d.farol === k);
  const docsVisiveisPorModelo = (modelo) =>
    docsDetalhados.filter((d) => d.modeloNorm === modelo && d.farol !== 'EMDIA');
  const docsPorTagStatus = (tag, k) =>
    docsDetalhados.filter((d) => d.tag === tag && d.farol === k);
  const docsVisiveisPorTag = (tag) =>
    docsDetalhados.filter((d) => d.tag === tag && d.farol !== 'EMDIA');

  // Tooltip flutuante customizada (segue o mouse, com lista de veiculos).
  const [tooltip, setTooltip] = useState(null); // { x, y, titulo, cor, itens }
  const tooltipTimer = useRef(null);

  const posicionarTooltip = (e) => {
    const pad = 16;
    const w = 300;
    const h = 330;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    return { x: Math.max(8, x), y };
  };

  const mostrarTooltip = (e, titulo, cor, itens) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltip({ ...posicionarTooltip(e), titulo, cor, itens });
  };
  const moverTooltip = (e) => {
    setTooltip((t) => (t ? { ...t, ...posicionarTooltip(e) } : t));
  };
  const esconderTooltip = (atraso = 120) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setTooltip(null), atraso);
  };
  const fixarTooltip = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
  };

  const docsPorFarol = useMemo(() => {
    const r = { EMDIA: 0, ATENCAO: 0, CRITICO: 0, PLANEJAMENTO: 0, VENCIDO: 0 };
    docsNeon.forEach((d) => { r[calcularFarol(d.validade).farol] += 1; });
    return r;
  }, [docsNeon]);

  const maxFarol = Math.max(...Object.values(docsPorFarol), 1);

  // Top modelos com mais documentos (dinâmico — antes hardcoded Caminhonete/Veículo Leve).
  const docsPorFarolPorModelo = useMemo(() => {
    const porModelo = new Map();
    docsNeon.forEach((d) => {
      const key = normalizarModelo(d.veiculo?.modelo || modeloPorTag.get(d.tag));
      if (!porModelo.has(key)) porModelo.set(key, []);
      porModelo.get(key).push(d);
    });
    const top = [...porModelo.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3)
      .map(([modelo]) => modelo);
    const r = {};
    top.forEach((m) => { r[m] = { EMDIA: 0, ATENCAO: 0, CRITICO: 0, PLANEJAMENTO: 0, VENCIDO: 0 }; });
    docsNeon.forEach((d) => {
      const key = normalizarModelo(d.veiculo?.modelo || modeloPorTag.get(d.tag));
      if (!r[key]) return;
      r[key][calcularFarol(d.validade).farol] += 1;
    });
    return r;
  }, [docsNeon, modeloPorTag]);

  // Top TAGs com mais documentos (dinâmico — antes lista fixa).
  const tagsRelevantes = useMemo(() => {
    const cont = new Map();
    docsNeon.forEach((d) => cont.set(d.tag, (cont.get(d.tag) || 0) + 1));
    return [...cont.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([tag]) => tag);
  }, [docsNeon]);

  const docsPorFarolPorTag = useMemo(() => {
    const r = {};
    tagsRelevantes.forEach((t) => { r[t] = { EMDIA: 0, ATENCAO: 0, CRITICO: 0, PLANEJAMENTO: 0, VENCIDO: 0 }; });
    docsNeon.forEach((d) => {
      if (r[d.tag]) r[d.tag][calcularFarol(d.validade).farol] += 1;
    });
    return r;
  }, [docsNeon, tagsRelevantes]);

  // Escala de altura das barras por TAG — apenas status visiveis (sem Em Dia).
  const farolMaxTag = useMemo(() => {
    const visiveis = ['ATENCAO', 'CRITICO', 'PLANEJAMENTO', 'VENCIDO'];
    let m = 0;
    Object.values(docsPorFarolPorTag).forEach(v => {
      const total = visiveis.reduce((a, k) => a + (v[k] || 0), 0);
      if (total > m) m = total;
    });
    return Math.max(m, 1);
  }, [docsPorFarolPorTag]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-4">
          <div className="text-center text-xs font-bold text-omega-800 mb-1">
            Controle de Mobilizacao por Contrato
          </div>
          <div className="text-center text-[10px] text-omega-400 mb-3">
            exclusivamente ativos • total mobilizado: <span className="font-black text-omega-700 tabular-nums">{totalMobilizados}</span>
          </div>
          <div className="flex items-center justify-center gap-4 mb-3 text-[11px] font-semibold text-omega-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CORES_STATUS.mob }} /> Mobilizado (Ativo)
            </span>
          </div>
          {carregandoFrota ? (
            <div className="px-4 py-8 text-center text-sm text-omega-500">Carregando...</div>
          ) : mobPorContrato.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-omega-500">Nenhum veículo mobilizado.</div>
          ) : (
            <div className="space-y-3 px-4">
              {mobPorContrato.map((d) => {
                const w = (d.total / maxMobContrato) * 100;
                return (
                  <div key={d.contrato} className="grid grid-cols-[120px_1fr_40px] items-center gap-3">
                    <div className="text-xs font-semibold text-omega-700 truncate" title={d.contrato}>{d.contrato}</div>
                    <div className="relative group flex h-9 rounded overflow-hidden shadow-inner bg-omega-100/60">
                      <div
                        className="flex items-center px-2 text-white text-[11px] font-bold transition-all"
                        style={{ width: `${w}%`, minWidth: '32px', background: CORES_STATUS.mob }}
                        title={`${d.contrato} — Mobilizado: ${d.total}`}
                      >
                        {d.total}
                      </div>
                      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-1 hidden group-hover:block z-10 whitespace-nowrap rounded-lg bg-omega-900 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-xl">
                        {d.contrato}: {d.total} mobilizado(s)
                      </div>
                    </div>
                    <div className="text-right font-black text-omega-800 text-sm tabular-nums" title={`Total ${d.contrato} mobilizado: ${d.total}`}>{d.total}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-4">
          <div className="text-center text-xs font-bold text-omega-800 mb-1">
            Controle de Modelos de Veiculos (Mobilizados)
          </div>
          <div className="text-center text-[10px] text-omega-400 mb-3">
            exclusivamente ativos • total mobilizado: <span className="font-black text-omega-700 tabular-nums">{totalMobilizados}</span>
          </div>
          <div className="flex items-center justify-center gap-3 mb-3 flex-wrap text-[11px] font-semibold text-omega-600">
            {contratosNosMobilizados.map((c) => (
              <span key={c} className="flex items-center gap-1.5" title={`Contrato ${c}`}>
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: corDoContrato(c) }} /> {c}
              </span>
            ))}
          </div>
          {carregandoFrota ? (
            <div className="px-2 py-8 text-center text-sm text-omega-500">Carregando...</div>
          ) : modelosMobilizados.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-omega-500">Nenhum veículo mobilizado.</div>
          ) : (
            <div className="space-y-2 px-2">
              {modelosMobilizados.map((m) => (
                <div key={m.modelo} className="grid grid-cols-[110px_1fr_36px] items-center gap-3 py-0.5">
                  <div className="text-[11px] font-semibold text-omega-700 truncate" title={m.modelo}>{m.modelo}</div>
                  <div
                    className="relative group flex h-6 rounded overflow-hidden bg-omega-100/60 shadow-inner"
                    title={`${m.modelo} — ${m.segmentos.map((s) => `${s.contrato}: ${s.n}`).join(' • ')} (total ${m.total})`}
                  >
                    {m.segmentos.map((s) => (
                      <div
                        key={s.contrato}
                        className="flex items-center justify-end px-1 text-white text-[9px] font-bold h-full"
                        style={{ width: `${(s.n / maxModeloMob) * 100}%`, background: s.cor, minWidth: '18px' }}
                        title={`${m.modelo} • ${s.contrato}: ${s.n} mobilizado(s)`}
                      >
                        {s.n}
                      </div>
                    ))}
                    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-1 hidden group-hover:block z-10 whitespace-nowrap rounded-lg bg-omega-900 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-xl">
                      {m.modelo}: {m.segmentos.map((s) => `${s.contrato} ${s.n}`).join(' + ')} = {m.total}
                    </div>
                  </div>
                  <div className="text-right font-black text-omega-800 text-xs tabular-nums" title={`Total ${m.modelo} mobilizado: ${m.total}`}>{m.total}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Faixa da secao Documentacao */}
      <div className="card px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-2.5 border-l-4 !border-l-omega-accent">
        <div className="w-9 h-9 rounded-xl bg-omega-900 flex items-center justify-center text-white shrink-0">
          <FileText size={17} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-extrabold text-omega-900 tracking-tight leading-tight">Documentação</h2>
          <p className="text-[11px] text-omega-500 mt-0.5">Resumo de vencimentos e farol de prazos da frota</p>
        </div>
        <div className="text-[11px] font-bold text-omega-500 tabular-nums whitespace-nowrap">
          {docsNeon.length} documento(s)
        </div>
      </div>

      {/* KPIs de resumo de vencimentos — topo da secao, acima dos graficos */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { k: 'EMDIA', i: CheckCircle2, sub: '> 30 dias' },
          { k: 'PLANEJAMENTO', i: Clock, sub: '16-30 dias' },
          { k: 'ATENCAO', i: FileWarning, sub: '6-15 dias' },
          { k: 'CRITICO', i: AlertTriangle, sub: '1-5 dias' },
          { k: 'VENCIDO', i: AlertTriangle, sub: 'Vencido' },
        ].map(item => (
          <div key={item.k} className="card p-4" style={{ borderTop: `3px solid ${FAROL_COR[item.k]}` }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${FAROL_COR[item.k]}15`, color: FAROL_COR[item.k] }}>
                <item.i size={15} />
              </div>
              <span className="text-[10px] font-semibold text-omega-600 uppercase tracking-wide leading-tight">{item.sub}</span>
            </div>
            <div className="text-2xl font-black tabular-nums" style={{ color: FAROL_COR[item.k] }}>
              {docsPorFarol[item.k]}
            </div>
            <div className="text-[11px] font-semibold text-omega-500 mt-0.5">{FAROL_LABEL[item.k].split('(')[0].trim()}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-4">
          <div className="text-center text-xs font-bold text-omega-800 mb-4">
            Farol de Vencimentos
          </div>
          <div className="space-y-3 px-2">
            {['VENCIDO', 'PLANEJAMENTO', 'CRITICO', 'ATENCAO'].map(k => {
              const v = docsPorFarol[k];
              const w = (v / maxFarol) * 100;
              return (
                <div
                  key={k}
                  className="grid grid-cols-[130px_1fr_36px] items-center gap-3 rounded-lg px-1 -mx-1 py-0.5 hover:bg-omega-50 transition-colors cursor-default"
                  onMouseEnter={(e) => mostrarTooltip(e, FAROL_LABEL[k].split('(')[0].trim(), FAROL_COR[k], docsPorStatus(k))}
                  onMouseMove={moverTooltip}
                  onMouseLeave={() => esconderTooltip()}
                >
                  <div className="text-[11px] font-semibold text-omega-700 text-right">{FAROL_LABEL[k]}</div>
                  <div className="h-8 rounded overflow-hidden bg-omega-100/60 shadow-inner">
                    <div
                      className="h-full flex items-center px-3 text-white text-xs font-bold"
                      style={{ width: `${w}%`, minWidth: v > 0 ? '40px' : '0', background: FAROL_COR[k] }}
                    >
                      {v > 0 ? v : ''}
                    </div>
                  </div>
                  <div className="text-right font-black text-omega-800 text-sm tabular-nums">{v}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-center text-xs font-bold text-omega-800 mb-4">
            Farol de Vencimentos por Modelo de Veiculo
          </div>
          <div className="flex items-end justify-center gap-10 px-4 pt-2 h-48">
            {Object.entries(docsPorFarolPorModelo).map(([modelo, data]) => {
              // Topo soma APENAS os status visiveis no empilhado (Em Dia fica fora do grafico).
              const ordem = ['ATENCAO', 'CRITICO', 'PLANEJAMENTO', 'VENCIDO'];
              const total = ordem.reduce((a, k) => a + (data[k] || 0), 0);
              return (
                <div key={modelo} className="flex flex-col items-center flex-1 max-w-[120px]">
                  <div
                    className="text-xs font-bold text-omega-800 mb-2 tabular-nums rounded px-1.5 hover:bg-omega-100 transition-colors cursor-default"
                    title={`${modelo} — todos os status visíveis`}
                    onMouseEnter={(e) => mostrarTooltip(e, `${modelo} — todos`, FAROL_COR.ATENCAO, docsVisiveisPorModelo(modelo))}
                    onMouseMove={moverTooltip}
                    onMouseLeave={() => esconderTooltip()}
                  >
                    {total}
                  </div>
                  <div className="w-20 flex flex-col-reverse rounded-t overflow-hidden shadow-inner min-h-[140px] bg-omega-100/30">
                    {ordem.map(k => {
                      const v = data[k];
                      if (v === 0) return null;
                      const h = (v / 8) * 100;
                      return (
                        <div
                          key={k}
                          className="w-full flex items-start justify-center text-white text-[10px] font-bold pt-0.5"
                          style={{ minHeight: v > 0 ? `${Math.max(h, 14)}px` : '0', background: FAROL_COR[k] }}
                          onMouseEnter={(e) => mostrarTooltip(e, `${modelo} — ${FAROL_LABEL[k].split('(')[0].trim()}`, FAROL_COR[k], docsPorModeloStatus(modelo, k))}
                          onMouseMove={moverTooltip}
                          onMouseLeave={() => esconderTooltip()}
                        >
                          {v}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[11px] font-semibold text-omega-700 mt-2 text-center">{modelo}</div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-3 mt-4 flex-wrap text-[10px] font-semibold text-omega-600">
            {Object.entries(FAROL_LABEL).filter(([k]) => k !== 'EMDIA').map(([k, lbl]) => (
              <span key={k} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FAROL_COR[k] }} />
                {lbl.split(' ')[0]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="text-center text-xs font-bold text-omega-800 mb-1">
          Farol de Vencimentos por TAG
        </div>
        <div className="flex items-center justify-center gap-3 mb-4 flex-wrap text-[10px] font-semibold text-omega-600">
          <span>Farol Vencimento</span>
          {Object.entries(FAROL_LABEL).filter(([k]) => k !== 'EMDIA').map(([k, lbl]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FAROL_COR[k] }} />
              {lbl.split('(')[0].trim()} (...)
            </span>
          ))}
        </div>
        <div className="flex items-end justify-between gap-2 px-4 h-48 overflow-x-auto">
          {tagsRelevantes.map(tag => {
            const data = docsPorFarolPorTag[tag];
            const ordem = ['ATENCAO', 'CRITICO', 'PLANEJAMENTO', 'VENCIDO'];
            const total = data ? ordem.reduce((a, k) => a + (data[k] || 0), 0) : 0;
            return (
              <div key={tag} className="flex flex-col items-center min-w-[70px] flex-1 max-w-[90px]">
                <div
                  className="text-[11px] font-bold text-omega-800 mb-1.5 tabular-nums rounded px-1.5 hover:bg-omega-100 transition-colors cursor-default"
                  title={`${tag} — todos os status visíveis`}
                  onMouseEnter={(e) => mostrarTooltip(e, `${tag} — todos`, FAROL_COR.ATENCAO, docsVisiveisPorTag(tag))}
                  onMouseMove={moverTooltip}
                  onMouseLeave={() => esconderTooltip()}
                >
                  {total}
                </div>
                <div className="w-full flex flex-col-reverse rounded-t overflow-hidden shadow-inner min-h-[160px] bg-omega-100/30">
                  {ordem.map(k => {
                    const v = data?.[k] || 0;
                    if (v === 0) return null;
                    const h = (v / farolMaxTag) * 140 + 6;
                    return (
                        <div
                          key={k}
                          className="w-full flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ height: `${h}px`, background: FAROL_COR[k] }}
                          onMouseEnter={(e) => mostrarTooltip(e, `${tag} — ${FAROL_LABEL[k].split('(')[0].trim()}`, FAROL_COR[k], docsPorTagStatus(tag, k))}
                          onMouseMove={moverTooltip}
                          onMouseLeave={() => esconderTooltip()}
                        >
                        {v}
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] font-bold text-omega-900 mt-2">{tag}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tooltip flutuante com a lista de veiculos da categoria em hover */}
      {tooltip && (
        <div
          className="fixed z-[70] w-[300px] max-w-[86vw] rounded-xl bg-omega-900 text-white shadow-2xl border border-white/10 overflow-hidden"
          style={{ left: tooltip.x, top: tooltip.y }}
          onMouseEnter={fixarTooltip}
          onMouseLeave={() => esconderTooltip(0)}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tooltip.cor }} />
            <div className="text-xs font-extrabold truncate">{tooltip.titulo}</div>
            <div className="ml-auto text-[10px] font-bold text-white/60 tabular-nums whitespace-nowrap">
              {tooltip.itens.length} veíc.
            </div>
          </div>
          <div className="max-h-64 overflow-auto p-1.5 space-y-1">
            {tooltip.itens.slice(0, 25).map((d) => (
              <div key={d.id} className="rounded-lg bg-white/5 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black">{d.tag}</span>
                  <span className="text-[10px] font-mono text-white/50">{d.placa}</span>
                  <span className="ml-auto text-[10px] font-bold whitespace-nowrap" style={{ color: tooltip.cor }}>
                    {FAROL_LABEL_CURTO[d.farol]}
                  </span>
                </div>
                <div className="text-[11px] text-white/80 truncate">{d.modeloNorm} • {d.documento}</div>
                <div className="text-[10px] text-white/50 tabular-nums">
                  Vence {formataData(d.validade)} • {textoDias(d.dias)}
                </div>
              </div>
            ))}
            {tooltip.itens.length === 0 && (
              <div className="text-[11px] text-white/60 px-2 py-3 text-center">Nenhum veículo nesta categoria.</div>
            )}
            {tooltip.itens.length > 25 && (
              <div className="text-[10px] text-white/50 text-center py-1">+{tooltip.itens.length - 25} outros…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
