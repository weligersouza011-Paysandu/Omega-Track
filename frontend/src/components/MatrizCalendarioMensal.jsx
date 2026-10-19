import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { authHeaders } from '../utils/sessao.js';
import { hojeISO } from '../utils/datas.js';

// ============================================================================
// Matriz Calendario — Analise Mensal Detalhada por Veiculo.
// Secao inferior da tela de Gestao de Eficiencia; consome
// GET /api/eficiencia/matriz e apresenta:
//   - painel esquerdo: gauge de aderencia do mes + metricas (dias em operacao
//     / dias validos, veiculos no filtro, meta e badge de status);
//   - painel direito: barras horizontais de aderencia por veiculo (verde,
//     amarelo e vermelho);
//   - grade TAG x dias (modelo planilha) com sabado/domingo marcados como SD
//     e feriados nacionais com F; dias fora da janela de mobilizacao
//     (antes de data_mob / apos data_desmob) ficam bloqueados (hachurados,
//     sem clique); clique na celula valida abre o modal de apontamento rapido
//     (POST /api/partes-diarias/apontamento-rapido) e recarrega a matriz +
//     dashboard sem F5;
//   - "Exportar Matriz em PDF": captura a secao com html2pdf.js (A4 paisagem,
//     cabecalho Omega Track / Contrato / Mes-Ano).
// ============================================================================

const META_ADERENCIA = 0.95;
const MES_MINIMO = '2024-01';

// Hachura das celulas bloqueadas (fora da janela de mobilizacao).
const HACHURA_BLOQUEIO = 'repeating-linear-gradient(45deg, rgba(2,6,23,0.60) 0px, rgba(2,6,23,0.60) 3px, rgba(2,6,23,0.15) 3px, rgba(2,6,23,0.15) 6px)';

const STATUS_MATRIZ = {
  operacao: { rotulo: 'Operação', cor: '#10B981' },
  preventiva: { rotulo: 'Manutenção Preventiva', cor: '#F59E0B' },
  corretiva: { rotulo: 'Manutenção Corretiva', cor: '#EF4444' },
  interdicao: { rotulo: 'Interdição', cor: '#D97706' },
  indisponibilidade: { rotulo: 'Indisponibilidade', cor: '#8B5CF6' },
  pendentes: { rotulo: 'Pendente', cor: '#6B7280' },
};

const STATUS_OPCOES = [
  'Operação',
  'Manutenção Preventiva',
  'Manutenção Corretiva',
  'Interdição',
  'Indisponibilidade',
];

const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const fmtNum = (n) => Number(n || 0).toLocaleString('pt-BR');
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

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

function corAderencia(v) {
  if (v === null || v === undefined) return '#475569';
  if (v >= 0.8) return '#10B981';
  if (v >= 0.5) return '#F59E0B';
  return '#EF4444';
}

function secaoParaStatusOpcao(secao) {
  switch (secao) {
    case 'operacao': return 'Operação';
    case 'preventiva': return 'Manutenção Preventiva';
    case 'corretiva': return 'Manutenção Corretiva';
    case 'interdicao': return 'Interdição';
    case 'indisponibilidade': return 'Indisponibilidade';
    default: return 'Operação';
  }
}

function badgeDoMes(eficiencia) {
  if (eficiencia === null || eficiencia === undefined) {
    return { rotulo: 'Sem base no mês', classe: 'border-slate-600 bg-slate-800/60 text-slate-300' };
  }
  if (eficiencia >= META_ADERENCIA) {
    return { rotulo: 'Acima da Meta', classe: 'border-emerald-700 bg-emerald-950/60 text-emerald-300' };
  }
  return { rotulo: 'Abaixo da Meta', classe: 'border-red-800 bg-red-950/60 text-red-300' };
}

// ---------------------------------------------------------------------------
// Gauge semicircular de aderencia (SVG puro, com marca da meta de 95%).
// ---------------------------------------------------------------------------
function GaugeAderencia({ valor }) {
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
  const tMeta = Math.PI * (1 - META_ADERENCIA);
  const metaExterno = [cx + (r + 9) * Math.cos(tMeta), cy - (r + 9) * Math.sin(tMeta)];
  const metaInterno = [cx + (r - 9) * Math.cos(tMeta), cy - (r - 9) * Math.sin(tMeta)];

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 240 138" className="w-full max-w-[270px]">
        <path d={arco(0.005, 0.492)} stroke="#EF4444" strokeWidth="15" strokeLinecap="round" fill="none" opacity="0.9" />
        <path d={arco(0.508, 0.792)} stroke="#F59E0B" strokeWidth="15" strokeLinecap="round" fill="none" opacity="0.9" />
        <path d={arco(0.808, 0.995)} stroke="#10B981" strokeWidth="15" strokeLinecap="round" fill="none" opacity="0.9" />
        <line
          x1={metaInterno[0]}
          y1={metaInterno[1]}
          x2={metaExterno[0]}
          y2={metaExterno[1]}
          stroke="#e2e8f0"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <text x={metaExterno[0]} y={metaExterno[1] - 6} textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="700">
          95%
        </text>
        <g transform={`rotate(${angulo} ${cx} ${cy})`}>
          <polygon points={`${cx - 4},${cy} ${cx + 4},${cy} ${cx},${cy - r + 26}`} fill="#e2e8f0" />
        </g>
        <circle cx={cx} cy={cy} r="9" fill="#0f172a" stroke="#e2e8f0" strokeWidth="3" />
      </svg>
      <div className="-mt-3 text-center">
        <div className="text-4xl font-extrabold tabular-nums tracking-tight text-white">
          {temValor ? (e * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
        <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Aderência do Mês</div>
        <div className="mt-0.5 text-[10px] text-slate-500">Operação ÷ (Operação + Desvios)</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras horizontais de aderencia por veiculo (verde / amarelo / vermelho).
// ---------------------------------------------------------------------------
function BarrasPorVeiculo({ veiculos }) {
  if (!veiculos.length) {
    return <p className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-center text-xs text-slate-500">Sem veículos no filtro para este mês.</p>;
  }
  return (
    <div className="mt-3 max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
      {veiculos.map((v) => {
        const cor = corAderencia(v.eficiencia);
        return (
          <div key={v.tag} title={`${v.tag} (${v.modelo}) — aderência ${fmtPct(v.eficiencia)} · Operação ${fmtNum(v.operacao)} · Desvios ${fmtNum(v.desvio)} · Preventiva ${fmtNum(v.preventiva)} · Pendências ${fmtNum(v.pendentes)}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-semibold text-slate-200">
                {v.tag}
                <span className="ml-1.5 font-normal text-slate-500">{v.placa || ''}</span>
              </span>
              <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: cor }}>
                {fmtPct(v.eficiencia)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{ width: `${(v.eficiencia ?? 0) * 100}%`, background: cor }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal de apontamento rapido de uma celula (TAG x dia).
// ---------------------------------------------------------------------------
function ModalApontamento({ celula, salvando, erro, onFechar, onSalvar }) {
  const [status, setStatus] = useState(() => secaoParaStatusOpcao(celula.secao));
  const statusAtual = celula.secao ? STATUS_MATRIZ[celula.secao] : null;

  useEffect(() => {
    const aoTeclar = (ev) => {
      if (ev.key === 'Escape' && !salvando) onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar, salvando]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={() => { if (!salvando) onFechar(); }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Apontamento Diário ${celula.tag} ${dataBR(celula.iso)}`}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Apontamento Diário</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              <span className="font-semibold text-sky-400">{celula.tag}</span>
              {' · '}
              {dataBR(celula.iso)}
              {celula.placa ? ` · ${celula.placa}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-40"
            aria-label="Fechar"
          >
            <X size={15} />
          </button>
        </div>

        {statusAtual && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusAtual.cor }} />
            <span className="text-[11px] text-slate-400">
              Status atual: <span className="font-semibold text-slate-200">{statusAtual.rotulo}</span>
            </span>
          </div>
        )}

        <label className="mt-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Novo status do dia</span>
          <select
            value={status}
            onChange={(ev) => setStatus(ev.target.value)}
            disabled={salvando}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm font-medium text-slate-200 outline-none transition-colors focus:border-sky-500"
          >
            {STATUS_OPCOES.map((opcao) => (
              <option key={opcao} value={opcao}>{opcao}</option>
            ))}
          </select>
        </label>

        {erro && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            <AlertTriangle size={14} className="shrink-0" />
            {erro}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onSalvar(status)}
            disabled={salvando}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {salvando && <Loader2 size={13} className="animate-spin" />}
            Salvar apontamento
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grade TAG x dias (matriz calendario).
// ---------------------------------------------------------------------------
function GradeMatriz({ dados, onClicarCelula }) {
  const veiculos = dados?.veiculos || [];

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800" data-matriz-scroll="1">
      <table className="w-full border-separate border-spacing-0 text-[10px]">
        <thead>
          <tr>
            <th data-sticky="1" className="sticky left-0 z-20 w-[84px] min-w-[84px] border-b border-r border-slate-800 bg-slate-900 px-2 py-1.5 text-left font-bold uppercase tracking-wider text-slate-400">TAG</th>
            <th data-sticky="1" className="sticky left-[84px] z-20 w-[132px] min-w-[132px] border-b border-r border-slate-800 bg-slate-900 px-2 py-1.5 text-left font-bold uppercase tracking-wider text-slate-400">Modelo</th>
            <th data-sticky="1" className="sticky left-[216px] z-20 w-[92px] min-w-[92px] border-b border-r border-slate-800 bg-slate-900 px-2 py-1.5 text-left font-bold uppercase tracking-wider text-slate-400">Placa</th>
            {(dados?.dias || []).map((d) => (
              <th
                key={d.iso}
                className={
                  'w-6 min-w-6 border-b border-slate-800 px-0 py-1 text-center font-bold tabular-nums ' +
                  (d.feriado
                    ? 'bg-red-950/80 text-red-200'
                    : d.fim_semana
                      ? 'bg-slate-800 text-slate-300'
                      : 'bg-slate-900 text-slate-400')
                }
                title={`${dataBR(d.iso)}${d.feriado ? ' — Feriado' : d.fim_semana ? ' — Fim de semana' : ''}`}
              >
                <div>{d.dia}</div>
                {d.feriado && <div className="mx-auto mt-0.5 w-fit rounded bg-red-800/80 px-1 text-[8px] leading-3 text-white">F</div>}
                {!d.feriado && d.fim_semana && <div className="mt-0.5 text-[8px] leading-3 text-slate-500">SD</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {veiculos.map((v) => {
            // Janela de mobilizacao do veiculo: dias antes de data_mob ou
            // apos data_desmob ficam bloqueados para apontamento (hachurados).
            const mobISO = v.data_mob ? String(v.data_mob).slice(0, 10) : null;
            const desmobISO = v.data_desmob ? String(v.data_desmob).slice(0, 10) : null;
            return (
              <tr key={v.tag}>
                <td data-sticky="1" className="sticky left-0 z-10 w-[84px] min-w-[84px] border-b border-r border-slate-800/70 bg-slate-950 px-2 py-1 font-bold text-slate-100">{v.tag}</td>
                <td data-sticky="1" className="sticky left-[84px] z-10 w-[132px] min-w-[132px] truncate border-b border-r border-slate-800/70 bg-slate-950 px-2 py-1 text-slate-400">{v.modelo}</td>
                <td data-sticky="1" className="sticky left-[216px] z-10 w-[92px] min-w-[92px] border-b border-r border-slate-800/70 bg-slate-950 px-2 py-1 tabular-nums text-slate-400">{v.placa || '—'}</td>
                {(dados?.dias || []).map((d) => {
                  const secao = v.dias?.[d.dia] ?? null;
                  const cfg = secao ? STATUS_MATRIZ[secao] : null;
                  const aposDesmob = Boolean(desmobISO && d.iso > desmobISO);
                  const antesMob = Boolean(mobISO && d.iso < mobISO);
                  const bloqueado = aposDesmob || antesMob;
                  const motivoBloqueio = aposDesmob
                    ? `após desmobilização em ${dataBR(desmobISO)}`
                    : `antes da mobilização em ${dataBR(mobISO)}`;
                  const estilo = bloqueado
                    ? { backgroundColor: cfg ? cfg.cor : '#1e293b', backgroundImage: HACHURA_BLOQUEIO, opacity: 0.85, borderColor: 'transparent' }
                    : cfg
                      ? { backgroundColor: cfg.cor, opacity: secao === 'pendentes' ? 0.55 : 0.9, borderColor: 'transparent' }
                      : { backgroundColor: 'rgba(51,65,85,0.28)', borderColor: 'transparent' };
                  return (
                    <td key={d.iso} className={'border-b border-slate-800/40 p-[3px] ' + (d.fim_semana ? 'bg-slate-900/70' : '')}>
                      <button
                        type="button"
                        disabled={d.futuro || bloqueado}
                        onClick={() => onClicarCelula({ tag: v.tag, placa: v.placa, modelo: v.modelo, dia: d.dia, iso: d.iso, secao })}
                        className={
                          'h-5 w-full rounded-[4px] border border-transparent transition-transform ' +
                          (d.futuro || bloqueado ? 'cursor-not-allowed' : 'hover:scale-110 hover:border-slate-300')
                        }
                        style={estilo}
                        title={bloqueado
                          ? `${v.tag} · ${dataBR(d.iso)} — ${cfg ? `${cfg.rotulo} · ` : ''}bloqueado (${motivoBloqueio})`
                          : `${v.tag} · ${dataBR(d.iso)} — ${cfg ? cfg.rotulo : 'Sem lançamento'}`}
                      aria-label={`${v.tag} ${dataBR(d.iso)}: ${cfg ? cfg.rotulo : 'sem lançamento'}${bloqueado ? ' (bloqueado)' : ''}`}
                    />
                  </td>
                );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function MatrizCalendarioMensal({ sessao, filtros = {}, onAtualizado }) {
  const [mes, setMes] = useState(() => hojeISO().slice(0, 7));
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [celula, setCelula] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState(null);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const printRef = useRef(null);

  const mesAtual = hojeISO().slice(0, 7);

  const buscar = useCallback(async (signal) => {
    setCarregando(true);
    setErro(null);
    const params = new URLSearchParams({ mes });
    if (filtros.tag) params.set('tag', filtros.tag);
    if (filtros.modelo) params.set('modelo', filtros.modelo);
    if (filtros.contrato) params.set('contrato', filtros.contrato);
    // Sem selecao = historico completo (desmobilizados com apontamento no mes
    // continuam visiveis na matriz).
    params.set('situacao', filtros.situacao || 'TODOS');
    const query = params.toString();
    try {
      const resp = await fetch(`/api/eficiencia/matriz?${query}`, { headers: authHeaders(sessao), signal });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo?.message || `Falha ao carregar a matriz (HTTP ${resp.status}).`);
      setDados(corpo.data);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.error('[matriz-calendario] Falha ao consultar a matriz', { url: `/api/eficiencia/matriz?${query}`, erro: e });
      setErro(e?.message || 'Falha ao consultar a matriz calendário.');
    } finally {
      setCarregando(false);
    }
  }, [mes, filtros.tag, filtros.modelo, filtros.contrato, filtros.situacao, sessao]);

  useEffect(() => {
    const ac = new AbortController();
    buscar(ac.signal);
    return () => ac.abort();
  }, [buscar]);

  const salvarApontamento = async (statusOperacional) => {
    if (!celula) return;
    setSalvando(true);
    setErroModal(null);
    try {
      const resp = await fetch('/api/partes-diarias/apontamento-rapido', {
        method: 'POST',
        headers: authHeaders(sessao),
        body: JSON.stringify({ tag: celula.tag, data: celula.iso, status_operacional: statusOperacional }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo?.message || `Falha ao salvar o apontamento (HTTP ${resp.status}).`);
      setCelula(null);
      await buscar();
      onAtualizado?.();
    } catch (e) {
      console.error('[matriz-calendario] Falha no apontamento rápido', e);
      setErroModal(e?.message || 'Falha ao salvar o apontamento.');
    } finally {
      setSalvando(false);
    }
  };

  const exportarPdf = async () => {
    if (!printRef.current || gerandoPdf || !dados) return;
    setGerandoPdf(true);
    const raiz = printRef.current;
    const rolagem = raiz.querySelector('[data-matriz-scroll]');
    const fixos = [...raiz.querySelectorAll('[data-sticky]')];
    const larguraOriginal = rolagem?.style.width || '';
    try {
      // HTML estatico na captura: sem overflow horizontal e sem colunas fixas,
      // para o html2canvas registrar a grade inteira no PDF.
      if (rolagem) {
        rolagem.style.overflowX = 'visible';
        rolagem.style.width = 'max-content';
      }
      fixos.forEach((th) => { th.style.position = 'static'; });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = html2pdfModule.default || html2pdfModule;
      await html2pdf().set({
        margin: [6, 6, 6, 6],
        filename: `Matriz_Calendario_${dados.mes}.pdf`,
        image: { type: 'png' },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#020617',
          scrollX: 0,
          scrollY: 0,
          logging: false,
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'landscape',
          compress: true,
        },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(raiz).save();
    } catch (e) {
      console.error('[matriz-calendario] Falha ao gerar o PDF', e);
    } finally {
      if (rolagem) {
        rolagem.style.overflowX = '';
        rolagem.style.width = larguraOriginal;
      }
      fixos.forEach((th) => { th.style.position = ''; });
      setGerandoPdf(false);
    }
  };

  const resumo = dados?.resumo;
  const badge = badgeDoMes(resumo?.eficiencia);
  const contratoRotulo = filtros.contrato ? `Contrato ${filtros.contrato}` : 'Contrato CT251';
  const podeVoltar = mes > MES_MINIMO;
  const podeAvancar = mes < mesAtual;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl ring-1 ring-slate-800 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarRange size={20} className="text-sky-400" />
            <h2 className="text-lg font-extrabold tracking-tight text-white">Matriz Calendário</h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">Análise Mensal Detalhada por Veículo</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!podeVoltar || carregando}
              onClick={() => setMes((m) => somarMes(m, -1))}
              className="rounded-lg border border-slate-700 p-1.5 text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Mês anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-[150px] text-center text-sm font-bold text-slate-100">{rotuloMesLongo(mes)}</span>
            <button
              type="button"
              disabled={!podeAvancar || carregando}
              onClick={() => setMes((m) => somarMes(m, 1))}
              className="rounded-lg border border-slate-700 p-1.5 text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Próximo mês"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => buscar()}
            disabled={carregando}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-sky-600 hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={13} className={carregando ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={exportarPdf}
            disabled={gerandoPdf || !dados}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {gerandoPdf ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
            Exportar Matriz em PDF
          </button>
        </div>
      </header>

      {erro && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3">
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

      <div ref={printRef} className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="text-sm font-extrabold tracking-tight text-white">
            Omega Track <span className="mx-1 text-slate-600">•</span> {contratoRotulo} <span className="mx-1 text-slate-600">•</span> {rotuloMesLongo(mes)}
          </div>
          <div className="text-[11px] text-slate-500">Matriz Calendário — Aderência mensal por veículo</div>
        </div>

        {carregando && !dados ? (
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="h-80 animate-pulse rounded-2xl bg-slate-900 xl:col-span-4" />
            <div className="h-80 animate-pulse rounded-2xl bg-slate-900 xl:col-span-8" />
          </div>
        ) : (
          <div className={'grid grid-cols-1 gap-4 xl:grid-cols-12 ' + (carregando ? 'opacity-60 transition-opacity' : '')}>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 xl:col-span-4">
              <GaugeAderencia valor={resumo?.eficiencia} />
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800 pt-3">
                <div className="rounded-lg bg-slate-950/60 px-3 py-2">
                  <div className="text-sm font-bold tabular-nums text-emerald-400">{fmtNum(resumo?.operacao)} / {fmtNum(resumo?.dias_validos)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Dias em operação / válidos</div>
                </div>
                <div className="rounded-lg bg-slate-950/60 px-3 py-2">
                  <div className="text-sm font-bold tabular-nums text-slate-200">{fmtNum(resumo?.veiculos)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Veículos no filtro</div>
                </div>
                <div className="rounded-lg bg-slate-950/60 px-3 py-2">
                  <div className="text-sm font-bold tabular-nums text-slate-200">{fmtPct(META_ADERENCIA)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Meta</div>
                </div>
                <div className="rounded-lg bg-slate-950/60 px-3 py-2">
                  <div className="text-sm font-bold tabular-nums text-slate-200">{fmtNum(resumo?.pendentes)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Pendências no mês</div>
                </div>
                <div className={`col-span-2 rounded-lg border px-3 py-2 text-center text-xs font-bold uppercase tracking-wider ${badge.classe}`}>
                  {badge.rotulo}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 xl:col-span-8">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100">Aderência por Veículo</h3>
                <span className="text-[10px] text-slate-500">Do menor para o maior aproveitamento</span>
              </div>
              <BarrasPorVeiculo veiculos={dados?.veiculos || []} />
            </div>

            <div className="xl:col-span-12">
              <GradeMatriz dados={dados} onClicarCelula={(c) => { setErroModal(null); setCelula(c); }} />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-800 pt-3">
                {Object.entries(STATUS_MATRIZ).map(([chave, cfg]) => (
                  <span key={chave} className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: cfg.cor, opacity: chave === 'pendentes' ? 0.55 : 0.9 }} />
                    {cfg.rotulo}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
                  <span className="rounded bg-slate-800 px-1 text-[9px] font-bold text-slate-300">SD</span>
                  Sábado / Domingo
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
                  <span className="rounded bg-red-800/80 px-1 text-[9px] font-bold text-white">F</span>
                  Feriado
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
                  <span className="h-2.5 w-2.5 rounded-sm border border-slate-600" style={{ backgroundColor: '#1e293b', backgroundImage: HACHURA_BLOQUEIO }} />
                  Bloqueado (fora da janela mob/desmob)
                </span>
                <span className="ml-auto text-[10px] italic text-slate-500">Clique na célula para lançar ou editar o apontamento do dia</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {celula && (
        <ModalApontamento
          celula={celula}
          salvando={salvando}
          erro={erroModal}
          onFechar={() => { if (!salvando) { setCelula(null); setErroModal(null); } }}
          onSalvar={salvarApontamento}
        />
      )}
    </section>
  );
}
