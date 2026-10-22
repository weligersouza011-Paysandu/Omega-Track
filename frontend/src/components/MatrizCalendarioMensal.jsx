import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownZA,
  ArrowUpAZ,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { authHeaders } from '../utils/sessao.js';
import { ehMaster } from '../utils/permissoes.js';
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
//     sem clique).
//   - Permissao: SOMENTE perfil MASTER edita celulas. Demais perfis veem a
//     grade em modo leitura (cursor padrao, sem abertura do modal); o backend
//     tambem bloqueia o endpoint com 403.
//   - Clique na celula valida (MASTER) abre o modal de apontamento rapido
//     (POST /api/partes-diarias/apontamento-rapido); ao salvar, a celula e
//     atualizada no estado local e a matriz + dashboard sao recarregados sem
//     F5 (metricas de aderencia do mes recalculadas automaticamente);
//   - "Exportar Matriz em PDF": gera um relatorio executivo dedicado em
//     paisagem (html2canvas + jsPDF), com cabecalho Omega Track / Contrato /
//     Mes-Ano, sumario de aderencia e a grade completa (todas as TAGs e dias)
//     ajustada ao formato A3/A2/A1 sem cortes laterais.
// ============================================================================

const META_ADERENCIA = 0.95;
const MES_MINIMO = '2024-01';

// Hachura das celulas bloqueadas (fora da janela de mobilizacao).
const HACHURA_BLOQUEIO = 'repeating-linear-gradient(45deg, rgba(2,6,23,0.60) 0px, rgba(2,6,23,0.60) 3px, rgba(2,6,23,0.15) 3px, rgba(2,6,23,0.15) 6px)';
// Hachura das celulas bloqueadas no relatorio PDF (tema claro para impressao).
const HACHURA_BLOQUEIO_PDF = 'repeating-linear-gradient(45deg, rgba(71,85,105,0.75) 0px, rgba(71,85,105,0.75) 2px, rgba(226,232,240,0.85) 2px, rgba(226,232,240,0.85) 6px)';

const SITUACOES_MATRIZ = [
  { valor: 'TODOS', rotulo: 'Histórico completo (MOB + DESMOB)' },
  { valor: 'MOB', rotulo: 'MOB — mobilizados' },
  { valor: 'DESMOB', rotulo: 'DESMOB — desmobilizados' },
];

const LARGURA_COLUNA_PDF = { tag: 84, modelo: 150, placa: 88, situacao: 60, dia: 26 };
const FORMATOS_PDF = [
  { nome: 'A3', largura: 420, altura: 297 },
  { nome: 'A2', largura: 594, altura: 420 },
  { nome: 'A1', largura: 841, altura: 594 },
];
const MARGEM_PDF_MM = 8;
// Escala minima (mm por px CSS) para manter a fonte de 10px legivel (~6 pt).
const ESCALA_MINIMA_PDF = 0.24;

const STATUS_MATRIZ = {
  operacao: { rotulo: 'Operação', sigla: 'O', cor: '#10B981', texto: '#052e16' },
  preventiva: { rotulo: 'Manutenção Preventiva', sigla: 'P', cor: '#F59E0B', texto: '#451a03' },
  corretiva: { rotulo: 'Manutenção Corretiva', sigla: 'C', cor: '#EF4444', texto: '#450a0a' },
  interdicao: { rotulo: 'Interdição', sigla: 'I', cor: '#D97706', texto: '#431407' },
  indisponibilidade: { rotulo: 'Indisponibilidade', sigla: 'ND', cor: '#8B5CF6', texto: '#2e1065' },
  nao_operado: { rotulo: 'Não Operado', sigla: 'NO', cor: '#64748B', texto: '#f8fafc' },
  pendentes: { rotulo: 'Pendente', cor: '#6B7280' },
};

const STATUS_OPCOES = [
  { valor: 'Operação', rotulo: 'Operação' },
  { valor: 'Manutenção Preventiva', rotulo: 'Manutenção Preventiva' },
  { valor: 'Manutenção Corretiva', rotulo: 'Manutenção Corretiva' },
  { valor: 'Interdição', rotulo: 'Interdição' },
  { valor: 'Indisponibilidade', rotulo: 'Indisponibilidade' },
  { valor: 'Não Operado', rotulo: 'Não Operado', descricao: 'Folga / Sem Demanda' },
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
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10;
  if (pct >= 100) return '#3B82F6';  // Azul — 100,0%
  if (pct >= 99)  return '#10B981';  // Verde — 99,0–99,9%
  if (pct >= 90)  return '#F59E0B';  // Amarelo — 90,0–98,9%
  if (pct >= 85)  return '#D97706';  // Laranja — 85,0–89,9%
  return '#EF4444';                  // Vermelho — < 85,0%
}

function secaoParaStatusOpcao(secao) {
  switch (secao) {
    case 'operacao': return 'Operação';
    case 'preventiva': return 'Manutenção Preventiva';
    case 'corretiva': return 'Manutenção Corretiva';
    case 'interdicao': return 'Interdição';
    case 'indisponibilidade': return 'Indisponibilidade';
    case 'nao_operado': return 'Não Operado';
    default: return 'Operação';
  }
}

function statusOpcaoParaSecao(opcao) {
  switch (opcao) {
    case 'Operação': return 'operacao';
    case 'Manutenção Preventiva': return 'preventiva';
    case 'Manutenção Corretiva': return 'corretiva';
    case 'Interdição': return 'interdicao';
    case 'Indisponibilidade': return 'indisponibilidade';
    case 'Não Operado': return 'nao_operado';
    default: return 'operacao';
  }
}

function corStatusOpcao(opcao) {
  return Object.values(STATUS_MATRIZ).find((s) => s.rotulo === opcao)?.cor || '#6B7280';
}

function ehCelulaDividida(valor) {
  return Boolean(valor && typeof valor === 'object' && valor.status_esq && valor.status_dir);
}

function secoesDaCelula(valor) {
  if (ehCelulaDividida(valor)) return [valor.status_esq, valor.status_dir];
  return valor ? [valor] : [];
}

function secaoPrincipalDaCelula(valor) {
  if (ehCelulaDividida(valor)) return valor.status_esq;
  return typeof valor === 'string' ? valor : null;
}

function descricaoCelula(tag, iso, valor, observacao) {
  if (ehCelulaDividida(valor)) {
    const primeira = valor.status_1 || valor.status_esq;
    const segunda = valor.status_2 || valor.status_dir;
    const rotulo1 = STATUS_MATRIZ[primeira]?.rotulo || '—';
    const rotulo2 = STATUS_MATRIZ[segunda]?.rotulo || '—';
    return `${tag} · ${dataBR(iso)} — 1ª: ${rotulo1} | 2ª: ${rotulo2}${observacao ? ` · ${observacao}` : ''}`;
  }
  const rotulo = valor ? STATUS_MATRIZ[valor]?.rotulo || '—' : 'Sem lançamento';
  return `${tag} · ${dataBR(iso)} — ${rotulo}${observacao ? ` · ${observacao}` : ''}`;
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
          {temValor ? `${(e * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—'}
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
    return <p className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-center text-xs text-slate-500">Nenhum veículo com lançamento neste mês.</p>;
  }
  return (
    <div className="mt-3 max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
      {veiculos.map((v) => {
        const cor = corAderencia(v.eficiencia);
        return (
          <div key={v.tag} title={`${v.tag} (${v.modelo}) — aderência ${fmtPct(v.eficiencia)} · Operação ${fmtNum(v.operacao)} · Desvios ${fmtNum(v.desvio)} · Preventiva ${fmtNum(v.preventiva)} · Não Operado ${fmtNum(v.nao_operado)} · Pendências ${fmtNum(v.pendentes)}`}>
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
  const dividida = ehCelulaDividida(celula.secao);
  const secaoInicial = dividida ? (celula.secao.status_dir || celula.secao.status_esq) : secaoPrincipalDaCelula(celula.secao);
  const [status, setStatus] = useState(() => secaoParaStatusOpcao(secaoInicial));
  const [observacao, setObservacao] = useState(() => celula.observacao || '');
  const secoesAtuais = dividida
    ? [celula.secao.status_1 || celula.secao.status_esq, celula.secao.status_2 || celula.secao.status_dir]
    : secoesDaCelula(celula.secao);
  const statusesAtuais = secoesAtuais
    .map((secao, idx) => ({ secao, cfg: STATUS_MATRIZ[secao], ordem: idx + 1 }))
    .filter((item) => item.cfg);
  const titulo = `Apontamento Rápido — ${celula.tag} — ${dataBR(celula.iso)}`;

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
        aria-label={titulo}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold leading-snug text-slate-100">{titulo}</h3>
            {(celula.placa || celula.modelo) && (
              <p className="mt-0.5 text-xs text-slate-400">
                {[celula.placa, celula.modelo].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="shrink-0 rounded-lg border border-slate-700 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-40"
            aria-label="Fechar"
          >
            <X size={15} />
          </button>
        </div>

        {statusesAtuais.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <span className="text-[11px] text-slate-400">
              {dividida ? 'Status atuais (dois lançamentos no dia):' : 'Status atual:'}
            </span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {statusesAtuais.map((item) => (
                <span key={item.secao} className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.cfg.cor }} />
                  <span className="font-semibold text-slate-200">
                    {dividida ? `${item.ordem}ª: ` : ''}{item.cfg.rotulo}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {dividida && (
          <p className="mt-2 text-[11px] text-amber-300/90">
            Este dia possui dois lançamentos. O novo status será aplicado a ambos.
          </p>
        )}

        <div className="mt-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Novo status do dia</span>
          <div role="radiogroup" aria-label="Novo status do dia" className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {STATUS_OPCOES.map((opcao) => {
              const cor = corStatusOpcao(opcao.valor);
              const selecionado = status === opcao.valor;
              return (
                <button
                  key={opcao.valor}
                  type="button"
                  role="radio"
                  aria-checked={selecionado}
                  onClick={() => setStatus(opcao.valor)}
                  disabled={salvando}
                  className={
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors disabled:opacity-50 ' +
                    (selecionado
                      ? 'text-white'
                      : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500 hover:bg-slate-800')
                  }
                  style={selecionado
                    ? { borderColor: cor, backgroundColor: `${cor}26`, boxShadow: `inset 0 0 0 1px ${cor}` }
                    : undefined}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/20" style={{ background: cor }} />
                  <span className="flex min-w-0 flex-col">
                    <span>{opcao.rotulo}</span>
                    {opcao.descricao && (
                      <span className={'text-[9px] font-medium ' + (selecionado ? 'text-white/70' : 'text-slate-500')}>
                        {opcao.descricao}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="mt-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Observação rápida (opcional)</span>
          <textarea
            value={observacao}
            onChange={(ev) => setObservacao(ev.target.value)}
            disabled={salvando}
            rows={3}
            maxLength={2000}
            placeholder="Detalhe o motivo ou deixe em branco."
            className="resize-none rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-500 disabled:opacity-60"
          />
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
            onClick={() => onSalvar(status, observacao.trim())}
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
function GradeMatriz({ dados, veiculos = [], podeEditar, onClicarCelula, ordemTag, onAlternarOrdemTag }) {
  if (!dados) return null;
  if (!veiculos.length) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 px-4 py-10 text-center" data-matriz-vazia="1">
        <p className="text-sm font-semibold text-slate-300">Nenhum veículo com lançamento neste mês.</p>
        <p className="mt-1 text-xs text-slate-500">A matriz exibe apenas veículos com ao menos um registro no período selecionado.</p>
      </div>
    );
  }
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800" data-matriz-scroll="1">
      <table className="w-full border-separate border-spacing-0 text-[10px]">
        <thead>
          <tr>
            <th
              data-sticky="1"
              aria-sort={ordemTag === 'asc' ? 'ascending' : 'descending'}
              className="sticky left-0 z-20 w-[84px] min-w-[84px] border-b border-r border-slate-800 bg-slate-900 px-2 py-1.5 text-left font-bold uppercase tracking-wider text-slate-400"
            >
              <button
                type="button"
                onClick={onAlternarOrdemTag}
                className="flex items-center gap-1 uppercase tracking-wider text-slate-400 transition-colors hover:text-white"
                title={`Ordenar TAG ${ordemTag === 'asc' ? 'de Z para A' : 'de A para Z'}`}
                aria-label={`Ordenar TAG ${ordemTag === 'asc' ? 'de Z para A' : 'de A para Z'}`}
              >
                TAG
                {ordemTag === 'asc' ? <ArrowUpAZ size={11} /> : <ArrowDownZA size={11} />}
              </button>
            </th>
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
                  const valor = v.dias?.[d.dia] ?? null;
                  const dividida = ehCelulaDividida(valor);
                  const secao = secaoPrincipalDaCelula(valor);
                  const observacao = v.observacoes?.[d.dia] ?? null;
                  const cfg = !dividida && secao ? STATUS_MATRIZ[secao] : null;
                  const aposDesmob = Boolean(desmobISO && d.iso > desmobISO);
                  const antesMob = Boolean(mobISO && d.iso < mobISO);
                  const bloqueado = aposDesmob || antesMob;
                  const motivoBloqueio = aposDesmob
                    ? `após desmobilização em ${dataBR(desmobISO)}`
                    : `antes da mobilização em ${dataBR(mobISO)}`;
                  const semPermissao = !podeEditar;
                  const desabilitado = semPermissao || d.futuro || bloqueado;
                  const estilo = bloqueado
                    ? { backgroundColor: '#1e293b', backgroundImage: HACHURA_BLOQUEIO, opacity: 0.9, borderColor: 'transparent' }
                    : dividida
                      ? {
                        backgroundImage: `linear-gradient(90deg, ${STATUS_MATRIZ[valor.status_esq]?.cor || '#475569'} 50%, ${STATUS_MATRIZ[valor.status_dir]?.cor || '#475569'} 50%)`,
                        borderColor: 'transparent',
                        opacity: 0.9,
                      }
                      : cfg
                        ? { backgroundColor: cfg.cor, opacity: secao === 'pendentes' ? 0.55 : 0.9, borderColor: 'transparent' }
                        : { backgroundColor: 'rgba(51,65,85,0.28)', borderColor: 'transparent' };
                  const descricao = descricaoCelula(v.tag, d.iso, valor, observacao);
                  return (
                    <td key={d.iso} className={'border-b border-slate-800/40 p-[3px] ' + (d.fim_semana ? 'bg-slate-900/70' : '')}>
                      <button
                        type="button"
                        disabled={desabilitado}
                        onClick={semPermissao ? undefined : () => {
                          if (d.futuro || bloqueado) return;
                          onClicarCelula({ tag: v.tag, placa: v.placa, modelo: v.modelo, dia: d.dia, iso: d.iso, secao: valor, observacao });
                        }}
                        className={
                          'flex h-5 w-full items-center justify-center rounded-[4px] border border-transparent transition-transform ' +
                          (semPermissao
                            ? 'cursor-default'
                            : d.futuro || bloqueado
                              ? 'cursor-not-allowed'
                              : 'cursor-pointer hover:scale-110 hover:border-slate-300')
                        }
                        style={estilo}
                        title={semPermissao
                          ? `${descricao} — modo de visualização: alterações restritas ao Usuário Master`
                          : bloqueado
                            ? `${descricao} — bloqueado (${motivoBloqueio})`
                            : descricao}
                        aria-label={`${descricao}${bloqueado ? ' (bloqueado)' : ''}${semPermissao ? ' (somente leitura)' : ''}`}
                      >
                        {!bloqueado && !dividida && cfg?.sigla && (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none text-[9px] font-extrabold leading-none"
                            style={{ color: cfg.texto }}
                          >
                            {cfg.sigla}
                          </span>
                        )}
                      </button>
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
// Relatorio executivo em PDF: cabecalho institucional, sumario de aderencia e
// grade completa (TAG x todos os dias do mes). Renderizado fora da tela para
// ser capturado pelo html2canvas em alta resolucao.
// ---------------------------------------------------------------------------
function RelatorioPdf({ dados, veiculos = [], mes, contrato, situacao }) {
  const dias = dados?.dias || [];
  const resumo = dados?.resumo || {};
  const larguraConteudo = LARGURA_COLUNA_PDF.tag + LARGURA_COLUNA_PDF.modelo + LARGURA_COLUNA_PDF.placa
    + LARGURA_COLUNA_PDF.situacao + dias.length * LARGURA_COLUNA_PDF.dia;
  const larguraTotal = larguraConteudo + 24; // + padding horizontal de 12px
  const geradoEm = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const rotuloSituacao = SITUACOES_MATRIZ.find((s) => s.valor === situacao)?.rotulo || 'Histórico completo';

  const cartoes = [
    { rotulo: 'Aderência do mês', valor: fmtPct(resumo.eficiencia), cor: corAderencia(resumo.eficiencia) },
    { rotulo: 'Dias em operação', valor: fmtNum(resumo.operacao), cor: '#047857' },
    { rotulo: 'Desvios', valor: fmtNum(resumo.desvio), cor: '#b91c1c' },
    { rotulo: 'Preventiva', valor: fmtNum(resumo.preventiva), cor: '#b45309' },
    { rotulo: 'Não Operado', valor: fmtNum(resumo.nao_operado), cor: '#475569' },
    { rotulo: 'Pendências', valor: fmtNum(resumo.pendentes), cor: '#b45309' },
    { rotulo: 'Veículos no mês', valor: fmtNum(veiculos.length), cor: '#0f172a' },
  ];

  const thBase = {
    border: '1px solid #94a3b8',
    backgroundColor: '#e2e8f0',
    color: '#0f172a',
    padding: '3px 4px',
    fontSize: 9,
    fontWeight: 700,
    textAlign: 'left',
    whiteSpace: 'nowrap',
  };
  const thDia = {
    border: '1px solid #cbd5e1',
    padding: '2px 0',
    fontSize: 8,
    fontWeight: 700,
    textAlign: 'center',
    lineHeight: '9px',
  };
  const tdBase = {
    border: '1px solid #cbd5e1',
    padding: '1px 4px',
    fontSize: 8.5,
    lineHeight: '11px',
    height: 20,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: '#0f172a',
    backgroundColor: '#ffffff',
  };
  const tdDia = {
    border: '1px solid #e2e8f0',
    padding: 0,
    height: 20,
    backgroundColor: '#ffffff',
  };

  return (
    <div
      style={{
        width: larguraTotal,
        backgroundColor: '#ffffff',
        color: '#0f172a',
        fontFamily: 'Arial, Helvetica, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      <header style={{ backgroundColor: '#0f172a', color: '#ffffff', padding: '14px 18px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0.3, lineHeight: '28px' }}>Omega Track</div>
            <div style={{ marginTop: 1, fontSize: 10, color: '#cbd5e1', letterSpacing: 0.4 }}>
              Gestão de Eficiência de Transporte
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{contrato}</div>
            <div style={{ marginTop: 1, fontSize: 12, color: '#e2e8f0' }}>{rotuloMesLongo(mes)}</div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginTop: 9,
            paddingTop: 8,
            borderTop: '1px solid #334155',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
            Matriz Calendário — Aderência mensal por veículo
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8' }}>
            {rotuloSituacao} · Gerado em {geradoEm}
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: '1px solid #cbd5e1', backgroundColor: '#f8fafc' }}>
        {cartoes.map((c) => (
          <div
            key={c.rotulo}
            style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 4, backgroundColor: '#ffffff', padding: '4px 6px' }}
          >
            <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b' }}>
              {c.rotulo}
            </div>
            <div style={{ marginTop: 1, fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: c.cor }}>
              {c.valor}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 12px 4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: LARGURA_COLUNA_PDF.tag }} />
            <col style={{ width: LARGURA_COLUNA_PDF.modelo }} />
            <col style={{ width: LARGURA_COLUNA_PDF.placa }} />
            <col style={{ width: LARGURA_COLUNA_PDF.situacao }} />
            {dias.map((d) => <col key={d.iso} style={{ width: LARGURA_COLUNA_PDF.dia }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={thBase}>TAG</th>
              <th style={thBase}>Modelo</th>
              <th style={thBase}>Placa</th>
              <th style={{ ...thBase, textAlign: 'center' }}>Situação</th>
              {dias.map((d) => (
                <th
                  key={d.iso}
                  style={{
                    ...thDia,
                    backgroundColor: d.feriado ? '#fee2e2' : d.fim_semana ? '#e2e8f0' : '#f1f5f9',
                    color: d.feriado ? '#991b1b' : d.fim_semana ? '#475569' : '#334155',
                  }}
                >
                  <div>{d.dia}</div>
                  <div style={{ fontSize: 7, lineHeight: '8px', fontWeight: 700 }}>
                    {d.feriado ? 'F' : d.fim_semana ? 'SD' : ''}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {veiculos.map((v) => {
              const mobISO = v.data_mob ? String(v.data_mob).slice(0, 10) : null;
              const desmobISO = v.data_desmob ? String(v.data_desmob).slice(0, 10) : null;
              return (
                <tr key={v.tag}>
                  <td style={{ ...tdBase, fontWeight: 700 }}>{v.tag}</td>
                  <td style={tdBase} title={v.modelo}>{v.modelo}</td>
                  <td style={{ ...tdBase, fontVariantNumeric: 'tabular-nums' }}>{v.placa || '—'}</td>
                  <td
                    style={{
                      ...tdBase,
                      textAlign: 'center',
                      fontWeight: 700,
                      fontSize: 7.5,
                      color: v.status === 'Desmobilizado' ? '#b91c1c' : v.status ? '#047857' : '#475569',
                    }}
                    title={desmobISO ? `Desmobilizado em ${dataBR(desmobISO)}` : v.status || 'Sem cadastro'}
                  >
                    {v.status === 'Desmobilizado' ? 'DESMOB' : v.status ? 'MOB' : '—'}
                  </td>
                  {dias.map((d) => {
                    const valor = v.dias?.[d.dia] ?? null;
                    const dividida = ehCelulaDividida(valor);
                    const secao = secaoPrincipalDaCelula(valor);
                    const cfg = !dividida && secao ? STATUS_MATRIZ[secao] : null;
                    const aposDesmob = Boolean(desmobISO && d.iso > desmobISO);
                    const antesMob = Boolean(mobISO && d.iso < mobISO);
                    const bloqueado = aposDesmob || antesMob;
                    const fundo = bloqueado
                      ? '#cbd5e1'
                      : dividida
                        ? '#ffffff'
                        : cfg
                          ? cfg.cor
                          : d.feriado
                            ? '#fee2e2'
                            : d.fim_semana
                              ? '#e2e8f0'
                              : '#ffffff';
                    const gradiente = dividida
                      ? `linear-gradient(90deg, ${STATUS_MATRIZ[valor.status_esq]?.cor || '#475569'} 50%, ${STATUS_MATRIZ[valor.status_dir]?.cor || '#475569'} 50%)`
                      : undefined;
                    const descricao = `${descricaoCelula(v.tag, d.iso, valor)}${bloqueado ? ' (bloqueado)' : ''}`;
                    return (
                      <td
                        key={d.iso}
                        title={descricao}
                        style={{
                          ...tdDia,
                          backgroundColor: fundo,
                          backgroundImage: bloqueado ? HACHURA_BLOQUEIO_PDF : gradiente,
                        }}
                      >
                        {!bloqueado && !dividida && cfg?.sigla && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              height: 18,
                              fontSize: 7,
                              fontWeight: 800,
                              lineHeight: '18px',
                              color: cfg.texto,
                            }}
                          >
                            {cfg.sigla}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '5px 14px',
          margin: '4px 12px 0',
          padding: '6px 0 10px',
          borderTop: '1px solid #cbd5e1',
          fontSize: 8,
          color: '#475569',
        }}
      >
        {Object.entries(STATUS_MATRIZ).map(([chave, cfg]) => (
          <span key={chave} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: cfg.cor, display: 'inline-block' }} />
            {cfg.rotulo}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: '#cbd5e1', backgroundImage: HACHURA_BLOQUEIO_PDF, display: 'inline-block' }} />
          Bloqueado (mob/desmob)
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ padding: '0 3px', borderRadius: 2, backgroundColor: '#e2e8f0', fontSize: 7, fontWeight: 700, color: '#475569' }}>SD</span>
          Fim de semana
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ padding: '0 3px', borderRadius: 2, backgroundColor: '#fee2e2', fontSize: 7, fontWeight: 700, color: '#991b1b' }}>F</span>
          Feriado
        </span>
        <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#0f172a' }}>
          {fmtNum(veiculos.length)} veículos · {fmtNum(dias.length)} dias
        </span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function MatrizCalendarioMensal({ sessao, onAtualizado }) {
  const [mes, setMes] = useState(() => hojeISO().slice(0, 7));
  const [situacao, setSituacao] = useState('TODOS');
  const [ordemTag, setOrdemTag] = useState('asc');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [celula, setCelula] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState(null);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [erroPdf, setErroPdf] = useState(null);
  const pdfRef = useRef(null);

  const mesAtual = hojeISO().slice(0, 7);
  // Somente MASTER edita a matriz; o backend reforca a regra (403).
  const podeEditar = ehMaster(sessao?.usuario);

  const veiculosOrdenados = useMemo(() => {
    const linhas = [...(dados?.veiculos || [])];
    const fator = ordemTag === 'asc' ? 1 : -1;
    return linhas.sort((a, b) => fator * String(a.tag || '').localeCompare(String(b.tag || ''), 'pt-BR', {
      numeric: true,
      sensitivity: 'base',
    }));
  }, [dados, ordemTag]);

  const buscar = useCallback(async (signal) => {
    setCarregando(true);
    setErro(null);
    const params = new URLSearchParams({ mes });
    // A matriz tem filtro proprio e independente do dashboard superior.
    // Somente TAGs com ao menos um apontamento no mes entram na tabela.
    params.set('situacao', situacao);
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
  }, [mes, situacao, sessao]);

  useEffect(() => {
    const ac = new AbortController();
    buscar(ac.signal);
    return () => ac.abort();
  }, [buscar]);

  // Atualizacao otimista da celula (TAG x dia) para feedback instantaneo;
  // em seguida buscar() recalcula aderencia/metricas do mes sem F5.
  const atualizarCelulaLocal = (tag, dia, secao, observacao) => {
    setDados((prev) => {
      if (!prev) return prev;
      const veiculos = (prev.veiculos || []).map((v) => {
        if (String(v.tag) !== String(tag)) return v;
        const proximosDias = { ...(v.dias || {}), [dia]: secao };
        const proximasObservacoes = { ...(v.observacoes || {}) };
        if (observacao) proximasObservacoes[dia] = observacao;
        else delete proximasObservacoes[dia];
        return { ...v, dias: proximosDias, observacoes: proximasObservacoes };
      });
      return { ...prev, veiculos };
    });
  };

  const salvarApontamento = async (statusOperacional, observacao) => {
    if (!celula) return;
    setSalvando(true);
    setErroModal(null);
    try {
      const resp = await fetch('/api/partes-diarias/apontamento-rapido', {
        method: 'POST',
        headers: authHeaders(sessao),
        body: JSON.stringify({
          tag: celula.tag,
          data: celula.iso,
          status_operacional: statusOperacional,
          observacao,
        }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo?.message || `Falha ao salvar o apontamento (HTTP ${resp.status}).`);
      atualizarCelulaLocal(celula.tag, celula.dia, statusOpcaoParaSecao(statusOperacional), observacao);
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
    const relatorio = pdfRef.current;
    if (!relatorio || gerandoPdf || carregando || !dados) return;
    setGerandoPdf(true);
    setErroPdf(null);
    try {
      await document.fonts?.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const larguraCss = relatorio.scrollWidth;
      const alturaCss = relatorio.scrollHeight;
      const escalaCaptura = 3;

      // Captura em alta resolucao para o PDF impresso manter textos nitidos.
      const canvas = await html2canvas(relatorio, {
        scale: escalaCaptura,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: larguraCss,
        height: alturaCss,
        windowWidth: larguraCss,
        windowHeight: alturaCss,
        scrollX: 0,
        scrollY: 0,
      });

      // Escolhe o menor formato paisagem (A3/A2/A1) que mantenha a fonte
      // legivel. Se nenhum atender, usa A1 e ajusta a tabela inteira.
      let formato = FORMATOS_PDF[FORMATOS_PDF.length - 1];
      for (const candidato of FORMATOS_PDF) {
        const escalaCss = Math.min(
          (candidato.largura - MARGEM_PDF_MM * 2) / larguraCss,
          (candidato.altura - MARGEM_PDF_MM * 2) / alturaCss,
        );
        if (escalaCss >= ESCALA_MINIMA_PDF) {
          formato = candidato;
          break;
        }
      }

      const escala = Math.min(
        (formato.largura - MARGEM_PDF_MM * 2) / larguraCss,
        (formato.altura - MARGEM_PDF_MM * 2) / alturaCss,
      );
      const larguraMm = larguraCss * escala;
      const alturaMm = alturaCss * escala;

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: [formato.largura, formato.altura],
        compress: true,
      });

      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.96),
        'JPEG',
        (formato.largura - larguraMm) / 2,
        (formato.altura - alturaMm) / 2,
        larguraMm,
        alturaMm,
        undefined,
        'FAST',
      );
      pdf.save(`OmegaTrack_Matriz_Calendario_${dados.mes || mes}.pdf`);
    } catch (e) {
      console.error('[matriz-calendario] Falha ao gerar o PDF', e);
      setErroPdf(e?.message || 'Falha ao gerar o PDF da matriz.');
    } finally {
      setGerandoPdf(false);
    }
  };

  const resumo = dados?.resumo;
  const badge = badgeDoMes(resumo?.eficiencia);
  const contratoRotulo = dados?.filtros?.contrato ? `Contrato ${dados.filtros.contrato}` : 'Contrato CT251';
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
          <p className="mt-0.5 text-xs text-slate-400">Análise Mensal Detalhada por Veículo · histórico completo do mês</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[220px] flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">MOB / DESMOB</span>
            <select
              value={situacao}
              onChange={(e) => setSituacao(e.target.value)}
              disabled={carregando}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-200 outline-none transition-colors focus:border-sky-500 disabled:opacity-50"
            >
              {SITUACOES_MATRIZ.map((s) => (
                <option key={s.valor} value={s.valor}>{s.rotulo}</option>
              ))}
            </select>
          </label>
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
            disabled={gerandoPdf || carregando || !dados}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {gerandoPdf ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
            {gerandoPdf ? 'Gerando PDF...' : 'Exportar Matriz em PDF'}
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

      {erroPdf && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-red-300">
            <AlertTriangle size={15} className="shrink-0" />
            {erroPdf}
          </div>
          <button
            type="button"
            onClick={() => setErroPdf(null)}
            className="shrink-0 rounded-lg border border-red-800 p-1.5 text-red-200 transition-colors hover:bg-red-900/40"
            aria-label="Fechar aviso"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:p-5">
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
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Veículos no mês</div>
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
              <GradeMatriz
                dados={dados}
                veiculos={veiculosOrdenados}
                podeEditar={podeEditar}
                ordemTag={ordemTag}
                onAlternarOrdemTag={() => setOrdemTag((ordem) => (ordem === 'asc' ? 'desc' : 'asc'))}
                onClicarCelula={(c) => { setErroModal(null); setCelula(c); }}
              />
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
                <span className="ml-auto text-[10px] italic text-slate-500">
                  {podeEditar
                    ? 'Clique na célula para lançar ou editar o apontamento do dia'
                    : 'Modo de visualização — alterações restritas ao Usuário Master'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Relatorio dedicado para exportacao: fora do fluxo e da area visivel. */}
      <div
        ref={pdfRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: '-20000px',
          zIndex: -1,
          pointerEvents: 'none',
          width: 'max-content',
        }}
      >
        {dados && (
          <RelatorioPdf
            dados={dados}
            veiculos={veiculosOrdenados}
            mes={dados.mes || mes}
            contrato={contratoRotulo}
            situacao={dados.filtros?.situacao || situacao}
          />
        )}
      </div>

      {celula && podeEditar && (
        <ModalApontamento
          key={`${celula.tag}|${celula.iso}`}
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
