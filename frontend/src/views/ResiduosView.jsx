// ============================================================================
// frontend/src/views/ResiduosView.jsx — Gestão de Resíduos (EcoGestão).
//
// Sub-módulo para inventário de resíduos, controle de MTR/MID, destinação
// (CMD vs EXTERNO), indicadores de volume (kg/L), gráficos analíticos (Recharts)
// e importação de planilhas com drag-and-drop e deduplicação automática.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileUp,
  Filter,
  Layers,
  Loader2,
  PieChart as PieIcon,
  Recycle,
  RefreshCw,
  Scale,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Modal from '../components/Modal.jsx';
import { authHeaders, lerSessao } from '../utils/sessao.js';
import { formatarDataSemTimezone } from '../utils/datas.js';

const TAMANHO_MAXIMO_ARQUIVO = 25 * 1024 * 1024;
const EXTENSOES_ACEITAS = /\.(xlsx|xls|csv)$/i;

const CORES_DESTINACAO = {
  CMD: '#10B981',     // Esmeralda corporativo
  EXTERNO: '#38BDF8', // Ciano/Azul claro
  OUTROS: '#A78BFA',  // Violeta
};

const CORES_PALETA = ['#10B981', '#38BDF8', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6'];

const TAMANHOS_PAGINA = [10, 25, 50, 100];

function fmtNumero(valor, casas = 0) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '0';
  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function fmtVolume(valor) {
  const numero = Number(valor) || 0;
  if (Math.abs(numero) >= 1_000_000) {
    return `${(numero / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}M`;
  }
  if (Math.abs(numero) >= 1_000) {
    return `${(numero / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  }
  return fmtNumero(numero, 1);
}

// ============================================================================
// COMPONENTE: MODAL DE IMPORTAÇÃO (DRAG-AND-DROP)
// ============================================================================
function ModalImportacao({ onClose, onImportado }) {
  const inputRef = useRef(null);
  const [arrastando, setArrastando] = useState(false);
  const [arquivo, setArquivo] = useState(null);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState(null);
  const [resultado, setResultado] = useState(null);

  const escolherArquivo = (file) => {
    if (!file) return;
    if (!EXTENSOES_ACEITAS.test(file.name)) {
      setErro('Formato invalido. Envie uma planilha .xlsx, .xls ou .csv.');
      setArquivo(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (file.size > TAMANHO_MAXIMO_ARQUIVO) {
      setErro('O arquivo excede o limite de 25 MB.');
      setArquivo(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setErro(null);
    setResultado(null);
    setArquivo(file);
  };

  const aoSoltar = (e) => {
    e.preventDefault();
    setArrastando(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) escolherArquivo(file);
  };

  const limpar = () => {
    setArquivo(null);
    setResultado(null);
    setErro(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const importar = async (e) => {
    e?.preventDefault();
    if (!arquivo || importando) return;

    setImportando(true);
    setErro(null);
    try {
      const sessao = lerSessao();
      const headers = {};
      if (sessao?.token) headers.Authorization = `Bearer ${sessao.token}`;
      if (sessao?.usuario?.matricula) headers['x-acting-matricula'] = sessao.usuario.matricula;

      const form = new FormData();
      form.append('arquivo', arquivo, arquivo.name);

      const resp = await fetch('/api/ecogestao/residuos/importar', {
        method: 'POST',
        headers,
        body: form,
      });

      const corpo = await resp.json().catch(() => ({}));
      const mensagem = corpo?.mensagem || corpo?.message || corpo?.error;

      if (!resp.ok) {
        throw new Error(mensagem || `Falha ao importar planilha (HTTP ${resp.status}).`);
      }

      setResultado(corpo);
      onImportado?.(corpo);
    } catch (err) {
      setErro(err?.message || 'Nao foi possivel importar a planilha.');
    } finally {
      setImportando(false);
    }
  };

  const resumo = resultado?.resumo || {};
  const importados = Number(resumo.importados) || 0;
  const duplicados = Number(resumo.duplicados_ignorados) || 0;
  const totalQtd = Number(resumo.total_quantidade_kg_l) || 0;
  const avisos = Array.isArray(resultado?.avisos) ? resultado.avisos : [];

  const rodape = resultado ? (
    <>
      <button type="button" onClick={limpar} className="btn-secondary text-xs">
        <FileUp size={14} />
        Importar outra
      </button>
      <button type="button" onClick={onClose} className="btn-primary text-xs !bg-emerald-600 hover:!bg-emerald-700">
        Concluir
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        onClick={onClose}
        disabled={importando}
        className="btn-secondary text-xs disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        type="submit"
        form="form-importar-residuos"
        disabled={!arquivo || importando}
        className="btn text-xs bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {importando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {importando ? 'Processando dados...' : 'Importar planilha'}
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Importar Planilha de Resíduos"
      subtitle="Envie o inventário de resíduos em .xlsx, .xls ou .csv (até 25 MB)."
      size="lg"
      footer={rodape}
    >
      {resultado ? (
        <div className="space-y-4">
          <div
            className={`rounded-xl border p-4 ${
              importados > 0
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                : 'border-amber-500/30 bg-amber-950/20 text-amber-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {importados > 0 ? (
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-400" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-bold text-white">
                  {resultado.mensagem || 'Processamento concluído com sucesso!'}
                </div>
                <div className="text-xs text-omega-300 mt-1">
                  Os dados foram processados, deduplicados e consolidados no banco de dados.
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-omega-800 bg-omega-900/60 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Inseridos</div>
              <div className="text-xl font-black text-emerald-400 tabular-nums mt-0.5">{fmtNumero(importados)}</div>
            </div>
            <div className="rounded-xl border border-omega-800 bg-omega-900/60 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Duplicados</div>
              <div className="text-xl font-black text-amber-400 tabular-nums mt-0.5">{fmtNumero(duplicados)}</div>
            </div>
            <div className="rounded-xl border border-omega-800 bg-omega-900/60 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Total (Kg/L)</div>
              <div className="text-xl font-black text-white tabular-nums mt-0.5">{fmtNumero(totalQtd, 1)}</div>
            </div>
            <div className="rounded-xl border border-omega-800 bg-omega-900/60 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Meses</div>
              <div className="text-xl font-black text-sky-400 tabular-nums mt-0.5">{resumo.meses_afetados?.length || 0}</div>
            </div>
          </div>

          {avisos.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300 mb-2">
                <AlertTriangle size={14} />
                Avisos / Linhas ignoradas ({avisos.length})
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 text-[11px] text-omega-300">
                {avisos.map((av, idx) => (
                  <div key={idx} className="flex items-center justify-between border-b border-white/5 py-0.5">
                    <span>Linha {av.linha}</span>
                    <span className="text-amber-400 font-medium">{av.motivo}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <form id="form-importar-residuos" onSubmit={importar} className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={aoSoltar}
            onClick={() => inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-150 ${
              arrastando
                ? 'border-emerald-500 bg-emerald-500/10 scale-[0.99]'
                : 'border-omega-700 bg-omega-900/40 hover:border-emerald-500/60 hover:bg-omega-900/80'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => escolherArquivo(e.target.files?.[0])}
            />

            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-3 shadow-inner">
              <FileSpreadsheet size={28} />
            </div>

            <div className="text-sm font-bold text-white text-center">
              {arquivo ? (
                <span className="text-emerald-400">{arquivo.name}</span>
              ) : (
                <>Arraste sua planilha aqui ou <span className="text-emerald-400 underline">clique para selecionar</span></>
              )}
            </div>

            <div className="text-xs text-omega-400 mt-1 text-center">
              Formatos aceitos: .xlsx, .xls ou .csv (até 25 MB)
            </div>

            {arquivo && (
              <div className="mt-3 flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-omega-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                {(arquivo.size / (1024 * 1024)).toFixed(2)} MB selecionado
              </div>
            )}
          </div>

          <div className="rounded-xl border border-omega-800 bg-omega-900/40 p-3.5 text-xs text-omega-400 space-y-1.5">
            <div className="font-bold text-omega-200 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Layers size={13} className="text-emerald-400" /> Colunas Reconhecidas Automaticamente
            </div>
            <p className="text-[11px] leading-relaxed">
              O importador mapeia variações de cabeçalhos como:
              <br />
              • <strong className="text-omega-300">Data:</strong> DATA, DT, DATA DA GERAÇÃO, DATA SAÍDA
              <br />
              • <strong className="text-omega-300">Tipo:</strong> TIPO DE RESÍDUO, RESÍDUO, CLASSIFICAÇÃO
              <br />
              • <strong className="text-omega-300">Manifesto:</strong> Nº MTR/MID, MTR, MID (opcional)
              <br />
              • <strong className="text-omega-300">Destinação:</strong> DESTINAÇÃO, DESTINO (ex: CMD, EXTERNO)
              <br />
              • <strong className="text-omega-300">Quantidade:</strong> QUANTIDADE (KG/L), PESO, VOLUME
            </p>
          </div>

          {erro && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 flex items-start gap-2.5 text-xs text-rose-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-400" />
              <span>{erro}</span>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL: RESÍDUOS VIEW
// ============================================================================
export default function ResiduosView() {
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState(null);

  // Filtros
  const [mesesDisponiveis, setMesesDisponiveis] = useState([]);
  const [mesSelecionado, setMesSelecionado] = useState('');
  const [filtroDestinacao, setFiltroDestinacao] = useState('TODOS');
  const [busca, setBusca] = useState('');

  // Dados
  const [registros, setRegistros] = useState([]);
  const [resumo, setResumo] = useState({
    total_registros: 0,
    total_quantidade_kg_l: 0,
    total_cmd: 0,
    total_externo: 0,
    total_outros: 0,
    total_mtrs: 0,
    por_destinacao: [],
    por_tipo: [],
    top_residuos: [],
  });

  // Modal
  const [modalImportacao, setModalImportacao] = useState(false);

  // Paginação
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  // Carrega lista de meses disponíveis
  const carregarMeses = useCallback(async () => {
    try {
      const resp = await fetch('/api/ecogestao/residuos/meses', {
        headers: authHeaders(),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const lista = Array.isArray(data?.meses) ? data.meses : [];
      setMesesDisponiveis(lista);

      // Se ainda não houver mês selecionado e existirem meses, seleciona o mais recente
      if (lista.length > 0) {
        setMesSelecionado((prev) => (prev ? prev : lista[0].mes_ano));
      }
    } catch (e) {
      console.error('Erro ao carregar meses de resíduos:', e);
    }
  }, []);

  // Carrega dados de resíduos do mês selecionado
  const carregarDados = useCallback(async (isRefresh = false) => {
    if (isRefresh) setAtualizando(true);
    else setCarregando(true);
    setErro(null);

    try {
      const params = new URLSearchParams();
      if (mesSelecionado && mesSelecionado !== 'TODOS') {
        params.append('mes_ano', mesSelecionado);
      }
      params.append('limite', '1000'); // Traz até 1000 registros para filtros rápidos client-side

      const resp = await fetch(`/api/ecogestao/residuos?${params.toString()}`, {
        headers: authHeaders(),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body?.message || `Erro ao carregar dados (HTTP ${resp.status}).`);
      }

      const resultado = await resp.json();
      setRegistros(Array.isArray(resultado?.dados) ? resultado.dados : []);
      if (resultado?.resumo) {
        setResumo(resultado.resumo);
      }
      setPagina(1);
    } catch (err) {
      setErro(err?.message || 'Falha na comunicação com o servidor.');
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  }, [mesSelecionado]);

  // Inicialização
  useEffect(() => {
    carregarMeses();
  }, [carregarMeses]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Filtros client-side na tabela
  const registrosFiltrados = useMemo(() => {
    return registros.filter((item) => {
      // Filtro de destinação
      if (filtroDestinacao !== 'TODOS') {
        const dest = String(item.destinacao || '').toUpperCase();
        if (filtroDestinacao === 'CMD' && !dest.includes('CMD')) return false;
        if (filtroDestinacao === 'EXTERNO' && !dest.includes('EXTERNO')) return false;
      }

      // Busca textual
      if (busca.trim()) {
        const termo = busca.toLowerCase().trim();
        const tipo = String(item.tipo_residuos || '').toLowerCase();
        const mtr = String(item.numero_mtr_mid || '').toLowerCase();
        const dest = String(item.destinacao || '').toLowerCase();
        const mes = String(item.mes_ano || '').toLowerCase();
        return tipo.includes(termo) || mtr.includes(termo) || dest.includes(termo) || mes.includes(termo);
      }

      return true;
    });
  }, [registros, filtroDestinacao, busca]);

  // Paginação
  const totalPaginas = Math.max(1, Math.ceil(registrosFiltrados.length / porPagina));
  const inicioIndex = (pagina - 1) * porPagina;
  const fimIndex = Math.min(inicioIndex + porPagina, registrosFiltrados.length);
  const registrosPaginados = useMemo(() => {
    return registrosFiltrados.slice(inicioIndex, fimIndex);
  }, [registrosFiltrados, inicioIndex, fimIndex]);

  // Dados para o Gráfico Donut de Proporção CMD vs EXTERNO
  const dadosDonut = useMemo(() => {
    const cmd = resumo.total_cmd || 0;
    const externo = resumo.total_externo || 0;
    const outros = resumo.total_outros || 0;
    const total = cmd + externo + outros;

    if (total === 0) return [];

    const resultado = [];
    if (cmd > 0) {
      resultado.push({
        name: 'CMD',
        valor: cmd,
        percentual: ((cmd / total) * 100).toFixed(1),
        cor: CORES_DESTINACAO.CMD,
      });
    }
    if (externo > 0) {
      resultado.push({
        name: 'EXTERNO',
        valor: externo,
        percentual: ((externo / total) * 100).toFixed(1),
        cor: CORES_DESTINACAO.EXTERNO,
      });
    }
    if (outros > 0) {
      resultado.push({
        name: 'OUTROS',
        valor: outros,
        percentual: ((outros / total) * 100).toFixed(1),
        cor: CORES_DESTINACAO.OUTROS,
      });
    }
    return resultado;
  }, [resumo]);

  // Dados para o Gráfico de Barras de Histórico Mensal
  const dadosHistoricoBarras = useMemo(() => {
    if (!mesesDisponiveis || mesesDisponiveis.length === 0) return [];
    // Clona e inverte para ficar em ordem cronológica (esq -> dir)
    return [...mesesDisponiveis]
      .reverse()
      .map((m) => ({
        mes: m.mes_ano,
        quantidade: m.total_quantidade_kg_l || 0,
        registros: m.total_registros || 0,
      }));
  }, [mesesDisponiveis]);

  // Callback ao concluir importação
  const aoImportar = () => {
    carregarMeses();
    carregarDados(true);
  };

  return (
    <div className="space-y-6">
      {/* ==================================================================== */}
      {/* 1. CABEÇALHO DA SUB-PÁGINA COM SELETOR DE MÊS E BOTÕES               */}
      {/* ==================================================================== */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-widest">
            <Recycle size={15} className="text-emerald-400" />
            EcoGestão • Meio Ambiente
          </div>
          <h1 className="mt-1 text-2xl font-black text-white tracking-tight sm:text-3xl flex items-center gap-2.5">
            Gestão de Resíduos
            <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-bold text-emerald-400">
              Operacional
            </span>
          </h1>
          <p className="mt-1 text-xs text-omega-300 sm:text-sm max-w-2xl">
            Inventário de resíduos gerados, controle de MTR/MID, destinações e volumes consolidados (kg/L).
          </p>
        </div>

        {/* Controles: Seletor de Mês, Atualizar e Importar */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Seletor de Mês/Ano */}
          <div className="relative">
            <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
            <select
              value={mesSelecionado}
              onChange={(e) => setMesSelecionado(e.target.value)}
              className="input !w-auto !py-2 pl-9 pr-8 text-xs font-bold bg-omega-900 border-omega-700 text-white focus:border-emerald-500"
              aria-label="Selecionar Mês/Ano"
            >
              {mesesDisponiveis.length === 0 ? (
                <option value="">Nenhum mês importado</option>
              ) : (
                <>
                  <option value="TODOS">Todos os meses</option>
                  {mesesDisponiveis.map((m) => (
                    <option key={m.mes_ano} value={m.mes_ano}>
                      {m.mes_ano} ({fmtNumero(m.total_registros)} reg.)
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          {/* Botão Atualizar */}
          <button
            type="button"
            onClick={() => carregarDados(true)}
            disabled={carregando || atualizando}
            className="btn-secondary !bg-omega-900 !border-omega-700 !text-omega-200 hover:!bg-omega-800 text-xs px-3 py-2"
            title="Atualizar dados"
          >
            <RefreshCw size={14} className={atualizando ? 'animate-spin text-emerald-400' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>

          {/* Botão + Importar Planilha */}
          <button
            type="button"
            onClick={() => setModalImportacao(true)}
            className="btn text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-950/40 px-3.5 py-2 flex items-center gap-1.5 transition-all duration-150"
          >
            <Upload size={14} />
            <span>+ Importar Planilha</span>
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 2. DASHBOARD SUPERIOR: 4 CARDS DE KPIs                                */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Gerado (Kg / L) */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-emerald-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Scale size={20} />
            </span>
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-black text-emerald-300 uppercase tracking-wider">
              Volume
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Total Gerado
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white sm:text-3xl tabular-nums tracking-tight">
              {fmtNumero(resumo.total_quantidade_kg_l, 1)}
            </span>
            <span className="text-xs font-bold text-emerald-400">Kg/L</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400 flex items-center gap-1">
            <span>Soma volumétrica no período selecionado</span>
          </div>
        </div>

        {/* Card 2: Total de Lançamentos */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-violet-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 to-purple-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
              <Layers size={20} />
            </span>
            <span className="rounded-full bg-violet-500/10 border border-violet-500/20 px-2.5 py-0.5 text-[10px] font-black text-violet-300 uppercase tracking-wider">
              Registros
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Total de Lançamentos
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white sm:text-3xl tabular-nums tracking-tight">
              {fmtNumero(resumo.total_registros)}
            </span>
            <span className="text-xs font-bold text-violet-400">itens</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400 flex items-center gap-1">
            <span>Linhas catalogadas e processadas</span>
          </div>
        </div>

        {/* Card 3: Destinação CMD vs Externo */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-sky-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
              <Building2 size={20} />
            </span>
            <span className="rounded-full bg-sky-500/10 border border-sky-500/20 px-2.5 py-0.5 text-[10px] font-black text-sky-300 uppercase tracking-wider">
              Destinação
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            CMD vs. Externo
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-black text-emerald-400 tabular-nums">
              {resumo.total_quantidade_kg_l > 0 ? ((resumo.total_cmd / resumo.total_quantidade_kg_l) * 100).toFixed(0) : 0}%
            </span>
            <span className="text-xs text-omega-500 font-bold">CMD</span>
            <span className="text-omega-600">•</span>
            <span className="text-lg font-black text-sky-400 tabular-nums">
              {resumo.total_quantidade_kg_l > 0 ? ((resumo.total_externo / resumo.total_quantidade_kg_l) * 100).toFixed(0) : 0}%
            </span>
            <span className="text-xs text-omega-500 font-bold">Ext.</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400">
            CMD: {fmtNumero(resumo.total_cmd, 0)} kg • Ext: {fmtNumero(resumo.total_externo, 0)} kg
          </div>
        </div>

        {/* Card 4: Manifestos MTR/MID */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-amber-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-orange-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <FileText size={20} />
            </span>
            <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[10px] font-black text-amber-300 uppercase tracking-wider">
              Compliance
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Manifestos MTR / MID
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white sm:text-3xl tabular-nums tracking-tight">
              {fmtNumero(resumo.total_mtrs)}
            </span>
            <span className="text-xs font-bold text-amber-400">emitidos</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400 flex items-center gap-1">
            <span>Documentos oficiais de rastreabilidade</span>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 3. GRÁFICOS ANALÍTICOS (RECHARTS TEMA DARK)                          */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico 1: Evolução Histórica dos Volumes por Mês (Barras) - Col 2 */}
        <div className="lg:col-span-2 rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card">
          <div className="flex items-center justify-between pb-4 border-b border-omega-800">
            <div>
              <div className="text-sm font-extrabold text-white flex items-center gap-2">
                <BarChart3 size={16} className="text-emerald-400" />
                Evolução Mensal de Geração de Resíduos
              </div>
              <div className="text-xs text-omega-400 mt-0.5">
                Volumes consolidados (Kg/L) mês a mês ao longo do histórico.
              </div>
            </div>
            <div className="text-xs text-omega-400 font-bold">
              {dadosHistoricoBarras.length} mês(es)
            </div>
          </div>

          <div className="mt-4 h-64 w-full">
            {dadosHistoricoBarras.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-omega-500 text-xs">
                <BarChart3 size={32} className="mb-2 opacity-40 text-omega-600" />
                Nenhum dado histórico registrado para exibir.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosHistoricoBarras} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                  <XAxis
                    dataKey="mes"
                    stroke="#64748B"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                  />
                  <YAxis
                    stroke="#64748B"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                    tickFormatter={(v) => fmtVolume(v)}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-xl border border-omega-700 bg-omega-950 p-3 shadow-2xl text-xs">
                          <div className="font-bold text-white mb-1.5 border-b border-omega-800 pb-1">
                            Mês: {d.mes}
                          </div>
                          <div className="flex items-center justify-between gap-4 text-emerald-400 font-medium">
                            <span>Volume:</span>
                            <strong className="font-black tabular-nums">{fmtNumero(d.quantidade, 1)} Kg/L</strong>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-omega-400 mt-1">
                            <span>Lançamentos:</span>
                            <span className="tabular-nums font-bold text-white">{fmtNumero(d.registros)}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="quantidade" radius={[6, 6, 0, 0]}>
                    {dadosHistoricoBarras.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.mes === mesSelecionado ? '#10B981' : '#047857'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Gráfico 2: Proporção de Destinação CMD vs EXTERNO (Donut) - Col 1 */}
        <div className="rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card flex flex-col justify-between">
          <div className="pb-4 border-b border-omega-800">
            <div className="text-sm font-extrabold text-white flex items-center gap-2">
              <PieIcon size={16} className="text-emerald-400" />
              Destinação de Resíduos
            </div>
            <div className="text-xs text-omega-400 mt-0.5">
              Proporção CMD vs. Externo no período.
            </div>
          </div>

          <div className="relative my-2 h-48 w-full flex items-center justify-center">
            {dadosDonut.length === 0 ? (
              <div className="text-center text-omega-500 text-xs">
                <PieIcon size={32} className="mx-auto mb-2 opacity-40 text-omega-600" />
                Sem registros no período.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0].payload;
                      return (
                        <div className="rounded-xl border border-omega-700 bg-omega-950 p-2.5 shadow-xl text-xs">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.cor }} />
                            {item.name}
                          </div>
                          <div className="mt-1 text-omega-300">
                            Volume: <strong className="text-white tabular-nums">{fmtNumero(item.valor, 1)} Kg/L</strong>
                          </div>
                          <div className="text-emerald-400 font-bold">
                            Proporção: {item.percentual}%
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Pie
                    data={dadosDonut}
                    dataKey="valor"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={74}
                    paddingAngle={3}
                  >
                    {dadosDonut.map((entry, index) => (
                      <Cell key={`donut-${index}`} fill={entry.cor} stroke="#0F172A" strokeWidth={2} />
                    ))}
                  </Pie>
                </RechartsPieChart>
              </ResponsiveContainer>
            )}

            {/* Texto central do Donut */}
            {dadosDonut.length > 0 && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Total</span>
                <span className="text-sm font-black text-white tabular-nums">
                  {fmtVolume(resumo.total_quantidade_kg_l)}
                </span>
              </div>
            )}
          </div>

          {/* Legenda Customizada com Percentuais e Volumes */}
          <div className="pt-3 border-t border-omega-800 space-y-2">
            {dadosDonut.map((d) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-omega-300">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.cor }} />
                  <span className="font-bold">{d.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-white tabular-nums">{fmtNumero(d.valor, 0)} Kg</span>
                  <span className="text-[11px] font-bold text-omega-400 tabular-nums">({d.percentual}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 4. TABELA DETALHADA COM BUSCA, FILTRO E PAGINAÇÃO                    */}
      {/* ==================================================================== */}
      <div className="rounded-2xl border border-omega-800 bg-omega-900 shadow-card overflow-hidden">
        {/* Barra superior de filtros da tabela */}
        <div className="p-4 border-b border-omega-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-omega-900/80">
          <div>
            <div className="text-sm font-black text-white flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-emerald-400" />
              Detalhamento dos Lançamentos
            </div>
            <div className="text-xs text-omega-400 mt-0.5">
              Inventário completo de resíduos, manifestos e destinações.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Input de busca */}
            <div className="relative w-full sm:w-64">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
              <input
                type="text"
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
                placeholder="Buscar resíduo, MTR, destino..."
                className="input !py-1.5 pl-8 pr-7 text-xs bg-omega-950 border-omega-700 text-white placeholder-omega-500 focus:border-emerald-500 w-full"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-omega-400 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Filtro por Destinação */}
            <div className="relative">
              <Filter size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-omega-400" />
              <select
                value={filtroDestinacao}
                onChange={(e) => { setFiltroDestinacao(e.target.value); setPagina(1); }}
                className="input !w-auto !py-1.5 pl-8 text-xs font-bold bg-omega-950 border-omega-700 text-white focus:border-emerald-500"
              >
                <option value="TODOS">Todos os Destinos</option>
                <option value="CMD">Apenas CMD</option>
                <option value="EXTERNO">Apenas EXTERNO</option>
              </select>
            </div>
          </div>
        </div>

        {/* Informações de registros filtrados */}
        <div className="px-4 py-2 bg-omega-950/60 border-b border-omega-800 text-[11px] text-omega-400 flex items-center justify-between">
          <span>
            Exibindo <strong className="text-white font-bold">{registrosFiltrados.length}</strong> de{' '}
            <strong className="text-white font-bold">{registros.length}</strong> lançamentos no mês
            {(busca || filtroDestinacao !== 'TODOS') && (
              <span className="ml-2 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[9px] font-bold uppercase">
                filtro ativo
              </span>
            )}
          </span>
          <span className="font-bold text-omega-300">
            Total filtrado: {fmtNumero(registrosFiltrados.reduce((acc, r) => acc + (r.quantidade_kg_l || 0), 0), 1)} Kg/L
          </span>
        </div>

        {/* Tabela Responsiva */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-omega-800 bg-omega-950/40 text-[10px] font-extrabold uppercase tracking-wider text-omega-400">
                <th className="py-3 px-4">Mês/Ano</th>
                <th className="py-3 px-4">Data</th>
                <th className="py-3 px-4">Tipo de Resíduo</th>
                <th className="py-3 px-4">Nº MTR / MID</th>
                <th className="py-3 px-4">Destinação</th>
                <th className="py-3 px-4 text-right">Quantidade (Kg/L)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-800/60">
              {carregando ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-omega-400">
                    <Loader2 size={24} className="mx-auto mb-2 animate-spin text-emerald-400" />
                    Carregando inventário de resíduos...
                  </td>
                </tr>
              ) : registrosPaginados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-omega-400">
                    <Trash2 size={28} className="mx-auto mb-2 opacity-30 text-omega-600" />
                    Nenhum lançamento encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                registrosPaginados.map((item) => {
                  const isCmd = String(item.destinacao || '').toUpperCase().includes('CMD');
                  const isExterno = String(item.destinacao || '').toUpperCase().includes('EXTERNO');

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-omega-800/40 transition-colors duration-100 group"
                    >
                      {/* Mês/Ano */}
                      <td className="py-3 px-4 font-mono text-[11px] text-omega-400 whitespace-nowrap">
                        {item.mes_ano || '—'}
                      </td>

                      {/* Data */}
                      <td className="py-3 px-4 font-bold text-omega-200 whitespace-nowrap">
                        {formatarDataSemTimezone(item.data)}
                      </td>

                      {/* Tipo de Resíduo */}
                      <td className="py-3 px-4 font-extrabold text-white">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span>{item.tipo_residuos}</span>
                        </div>
                      </td>

                      {/* Nº MTR / MID */}
                      <td className="py-3 px-4 font-mono text-xs text-omega-300">
                        {item.numero_mtr_mid ? (
                          <span className="inline-flex items-center gap-1 rounded bg-omega-800/80 border border-omega-700/60 px-2 py-0.5 text-[11px] font-bold text-omega-200">
                            <FileText size={11} className="text-amber-400" />
                            {item.numero_mtr_mid}
                          </span>
                        ) : (
                          <span className="text-omega-600">—</span>
                        )}
                      </td>

                      {/* Destinação */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider border ${
                            isCmd
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : isExterno
                              ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                              : 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                          }`}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: isCmd ? '#10B981' : isExterno ? '#38BDF8' : '#A78BFA' }}
                          />
                          {item.destinacao}
                        </span>
                      </td>

                      {/* Quantidade (Kg/L) */}
                      <td className="py-3 px-4 text-right font-black tabular-nums text-white text-sm">
                        {fmtNumero(item.quantidade_kg_l, 1)}{' '}
                        <span className="text-[10px] font-bold text-omega-400">kg/L</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé da Tabela: Paginação */}
        <div className="p-4 border-t border-omega-800 bg-omega-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-omega-400">
          <div className="flex items-center gap-3">
            <span>
              Mostrando <strong className="text-white tabular-nums">{registrosFiltrados.length === 0 ? 0 : inicioIndex + 1}</strong> a{' '}
              <strong className="text-white tabular-nums">{fimIndex}</strong> de{' '}
              <strong className="text-white tabular-nums">{registrosFiltrados.length}</strong>
            </span>

            <div className="flex items-center gap-1.5 ml-2 border-l border-omega-800 pl-3">
              <span className="text-[11px]">Por página:</span>
              <select
                value={porPagina}
                onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(1); }}
                className="input !w-auto !py-1 text-xs bg-omega-900 border-omega-700 text-white"
              >
                {TAMANHOS_PAGINA.map((tam) => (
                  <option key={tam} value={tam}>{tam}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setPagina(1)}
              disabled={pagina <= 1}
              className="p-1.5 rounded-lg border border-omega-800 bg-omega-900 hover:bg-omega-800 text-omega-300 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Primeira página"
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1}
              className="p-1.5 rounded-lg border border-omega-800 bg-omega-900 hover:bg-omega-800 text-omega-300 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Página anterior"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-3 text-xs font-bold text-white tabular-nums">
              Página {pagina} de {totalPaginas}
            </span>
            <button
              type="button"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas}
              className="p-1.5 rounded-lg border border-omega-800 bg-omega-900 hover:bg-omega-800 text-omega-300 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Próxima página"
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => setPagina(totalPaginas)}
              disabled={pagina >= totalPaginas}
              className="p-1.5 rounded-lg border border-omega-800 bg-omega-900 hover:bg-omega-800 text-omega-300 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Última página"
            >
              <ChevronsRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Importação */}
      {modalImportacao && (
        <ModalImportacao
          onClose={() => setModalImportacao(false)}
          onImportado={aoImportar}
        />
      )}
    </div>
  );
}
