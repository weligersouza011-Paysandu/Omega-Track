// ============================================================================
// frontend/src/views/ProdutosQuimicosView.jsx — Tratamento de Produtos Químicos.
//
// Sub-módulo para controle de inventário químico, FISPQ/FDS, matriz de
// periculosidade (7 classes de risco), locais de armazenamento e validades.
// Inclui KPIs de conformidade, gráficos Recharts, tabela com filtros rápidos
// e modais de importação e cadastro manual.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  Archive,
  BarChart3,
  Bomb,
  Building,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Edit2,
  FileSpreadsheet,
  FileText,
  FileUp,
  Filter,
  Flame,
  FlaskConical,
  HelpCircle,
  Layers,
  Loader2,
  Package,
  PieChart as PieIcon,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wind,
  X,
  Zap,
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
import { formatarDataSemTimezone, hojeISO, paraInputData } from '../utils/datas.js';

const TAMANHO_MAXIMO_ARQUIVO = 25 * 1024 * 1024;
const EXTENSOES_ACEITAS = /\.(xlsx|xls|csv)$/i;

const CORES_PERIGOS = {
  inflamavel: '#F97316', // Laranja fogo
  toxico: '#A855F7',     // Roxo tóxico
  corrosivo: '#EAB308',  // Âmbar ácido
  explosivo: '#EF4444',  // Vermelho explosão
  piroforico: '#06B6D4', // Ciano pirofórico
  oxidante: '#3B82F6',   // Azul oxidante
  radioativo: '#EC4899', // Rosa radioativo
};

const LABELS_PERIGOS = {
  inflamavel: 'Inflamável',
  toxico: 'Tóxico',
  corrosivo: 'Corrosivo',
  explosivo: 'Explosivo',
  piroforico: 'Pirofórico',
  oxidante: 'Oxidante',
  radioativo: 'Radioativo',
};

const ICONES_PERIGOS = {
  inflamavel: Flame,
  toxico: AlertOctagon,
  corrosivo: FlaskConical,
  explosivo: Bomb,
  piroforico: Zap,
  oxidante: Wind,
  radioativo: Radio,
};

const LOCAIS_SUGERIDOS = [
  'ALMOXARIFADO CENTRAL',
  'CONTAINER QUÍMICO 01',
  'CONTAINER QUÍMICO 02',
  'PÁTIO DE MANUTENÇÃO',
  'LAVA-JATO / OFICINA',
  'ÁREA DE SOLDAGEM',
  'DEPÓSITO DE RESÍDUOS',
];

const COMPOSICOES_SUGERIDAS = [
  'MISTURA DE GASES',
  'ÁLCOOL ETÍLICO',
  'SOLVENTE ALIFÁTICO',
  'ACETILENO',
  'OXIGÊNIO COMPRIMIDO',
  'GRAXA / ÓLEO LUBRIFICANTE',
  'DETERGENTE NEUTRO / DESENGRAXANTE',
];

const TAMANHOS_PAGINA = [10, 25, 50, 100];

function fmtNumero(valor, casas = 0) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '0';
  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function diasRestantesTexto(dataValidade) {
  if (!dataValidade) return '';
  const val = new Date(dataValidade);
  if (Number.isNaN(val.getTime())) return '';
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diffDias = Math.ceil((val - hoje) / (1000 * 60 * 60 * 24));

  if (diffDias < 0) {
    const d = Math.abs(diffDias);
    return `Vencido há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  }
  if (diffDias === 0) return 'Vence hoje';
  if (diffDias <= 30) return `Vence em ${diffDias} ${diffDias === 1 ? 'dia' : 'dias'}`;
  return `${diffDias} dias restantes`;
}

function badgeStatusValidade(dataValidade) {
  if (!dataValidade) {
    return {
      texto: 'Indeterminado',
      classe: 'bg-omega-800 text-omega-400 border-omega-700/60',
    };
  }
  const val = new Date(dataValidade);
  if (Number.isNaN(val.getTime())) {
    return {
      texto: 'Indeterminado',
      classe: 'bg-omega-800 text-omega-400 border-omega-700/60',
    };
  }
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diffDias = Math.ceil((val - hoje) / (1000 * 60 * 60 * 24));

  if (diffDias < 0) {
    return {
      texto: 'Vencido',
      classe: 'bg-rose-500/15 text-rose-400 border-rose-500/40',
    };
  }
  if (diffDias <= 30) {
    return {
      texto: 'A Vencer',
      classe: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    };
  }
  return {
    texto: 'Normal',
    classe: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  };
}

export default function ProdutosQuimicosView() {
  const [produtos, setProdutos] = useState([]);
  const [resumo, setResumo] = useState({
    total_produtos: 0,
    total_perigosos: 0,
    total_nao_perigosos: 0,
    total_vencidos: 0,
    total_a_vencer: 0,
    matriz_perigos: {
      inflamavel: 0,
      piroforico: 0,
      explosivo: 0,
      oxidante: 0,
      corrosivo: 0,
      toxico: 0,
      radioativo: 0,
    },
    por_local: [],
    por_composicao: [],
  });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  // Filtros
  const [filtroEnquadramento, setFiltroEnquadramento] = useState('TODOS');
  const [filtroPerigo, setFiltroPerigo] = useState('TODOS');
  const [filtroValidade, setFiltroValidade] = useState('TODOS');
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');

  // Paginação
  const [pagina, setPagina] = useState(1);
  const [limite, setLimite] = useState(25);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);

  // Modais
  const [modalImportarAberto, setModalImportarAberto] = useState(false);
  const [modalCadastroAberto, setModalCadastroAberto] = useState(false);
  const [modalExcluirAberto, setModalExcluirAberto] = useState(false);
  const [produtoEditando, setProdutoEditando] = useState(null);
  const [produtoExcluindo, setProdutoExcluindo] = useState(null);

  // Formulário Manual
  const [form, setForm] = useState({
    nome_produto: '',
    fds_fispq: 'SIM',
    marca_produto: '',
    substancias_composicao: '',
    enquadramento_produto: 'PERIGOSO',
    validade_produto: '',
    local_armazenamento: 'ALMOXARIFADO CENTRAL',
    inflamavel: false,
    piroforico: false,
    explosivo: false,
    oxidante: false,
    corrosivo: false,
    toxico: false,
    radioativo: false,
  });
  const [salvandoForm, setSalvandoForm] = useState(false);
  const [erroForm, setErroForm] = useState(null);

  // Importação
  const [arquivoUpload, setArquivoUpload] = useState(null);
  const [enviandoUpload, setEnviandoUpload] = useState(false);
  const [relatorioUpload, setRelatorioUpload] = useState(null);
  const [erroUpload, setErroUpload] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Debounce da busca
  useEffect(() => {
    const timer = setTimeout(() => {
      setBuscaDebounced(busca);
      setPagina(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [busca]);

  // Carregar produtos da API
  const carregarProdutos = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (filtroEnquadramento !== 'TODOS') params.set('enquadramento', filtroEnquadramento);
      if (filtroPerigo !== 'TODOS') params.set('perigo', filtroPerigo);
      if (filtroValidade !== 'TODOS') params.set('status_validade', filtroValidade);
      if (buscaDebounced.trim()) params.set('busca', buscaDebounced.trim());
      params.set('pagina', String(pagina));
      params.set('limite', String(limite));

      const resposta = await fetch(`/api/ecogestao/produtos-quimicos?${params.toString()}`, {
        headers: authHeaders(),
      });

      if (!resposta.ok) {
        const dadosErro = await resposta.json().catch(() => ({}));
        throw new Error(dadosErro.message || `Erro ${resposta.status}: Falha ao buscar produtos químicos.`);
      }

      const dados = await resposta.json();
      setProdutos(dados.produtos || []);
      setResumo(dados.resumo || {});
      setTotalRegistros(dados.paginacao?.total || 0);
      setTotalPaginas(dados.paginacao?.total_paginas || 1);
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }, [filtroEnquadramento, filtroPerigo, filtroValidade, buscaDebounced, pagina, limite]);

  useEffect(() => {
    carregarProdutos();
  }, [carregarProdutos]);

  // Abrir Modal de Cadastro Manual
  const abrirCadastroNovo = () => {
    setProdutoEditando(null);
    setForm({
      nome_produto: '',
      fds_fispq: 'SIM',
      marca_produto: '',
      substancias_composicao: '',
      enquadramento_produto: 'PERIGOSO',
      validade_produto: '',
      local_armazenamento: 'ALMOXARIFADO CENTRAL',
      inflamavel: false,
      piroforico: false,
      explosivo: false,
      oxidante: false,
      corrosivo: false,
      toxico: false,
      radioativo: false,
    });
    setErroForm(null);
    setModalCadastroAberto(true);
  };

  // Abrir Modal de Edição
  const abrirEdicao = (prod) => {
    setProdutoEditando(prod);
    setForm({
      nome_produto: prod.nome_produto || '',
      fds_fispq: prod.fds_fispq || '',
      marca_produto: prod.marca_produto || '',
      substancias_composicao: prod.substancias_composicao || '',
      enquadramento_produto: prod.enquadramento_produto || 'PERIGOSO',
      validade_produto: paraInputData(prod.validade_produto),
      local_armazenamento: prod.local_armazenamento || '',
      inflamavel: Boolean(prod.inflamavel),
      piroforico: Boolean(prod.piroforico),
      explosivo: Boolean(prod.explosivo),
      oxidante: Boolean(prod.oxidante),
      corrosivo: Boolean(prod.corrosivo),
      toxico: Boolean(prod.toxico),
      radioativo: Boolean(prod.radioativo),
    });
    setErroForm(null);
    setModalCadastroAberto(true);
  };

  // Salvar Produto (Novo ou Edição)
  const salvarProduto = async (e) => {
    e.preventDefault();
    if (!form.nome_produto.trim()) {
      setErroForm('Informe o nome do produto químico.');
      return;
    }

    setSalvandoForm(true);
    setErroForm(null);

    try {
      const url = produtoEditando
        ? `/api/ecogestao/produtos-quimicos/${produtoEditando.id}`
        : '/api/ecogestao/produtos-quimicos';
      const metodo = produtoEditando ? 'PUT' : 'POST';

      const payload = {
        ...form,
        validade_produto: form.validade_produto || null,
      };

      const res = await fetch(url, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const dadosErro = await res.json().catch(() => ({}));
        throw new Error(dadosErro.message || `Erro ${res.status}: Não foi possível salvar o produto.`);
      }

      setModalCadastroAberto(false);
      carregarProdutos();
    } catch (err) {
      setErroForm(err.message);
    } finally {
      setSalvandoForm(false);
    }
  };

  // Excluir Produto
  const confirmarExclusao = async () => {
    if (!produtoExcluindo) return;
    try {
      const res = await fetch(`/api/ecogestao/produtos-quimicos/${produtoExcluindo.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Falha ao excluir produto.');
      }
      setModalExcluirAberto(false);
      setProdutoExcluindo(null);
      carregarProdutos();
    } catch (err) {
      alert(err.message);
    }
  };

  // Importar Planilha
  const handleSelecionarArquivo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    validarEPrepararArquivo(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    validarEPrepararArquivo(file);
  };

  const validarEPrepararArquivo = (file) => {
    setErroUpload(null);
    setRelatorioUpload(null);

    if (!EXTENSOES_ACEITAS.test(file.name)) {
      setErroUpload('Formato de arquivo inválido. Envie uma planilha .xlsx, .xls ou .csv.');
      return;
    }
    if (file.size > TAMANHO_MAXIMO_ARQUIVO) {
      setErroUpload('Arquivo muito grande. O limite máximo permitido é de 25 MB.');
      return;
    }
    setArquivoUpload(file);
  };

  const enviarPlanilha = async () => {
    if (!arquivoUpload) return;
    setEnviandoUpload(true);
    setErroUpload(null);

    try {
      const formData = new FormData();
      formData.append('arquivo', arquivoUpload);

      const res = await fetch('/api/ecogestao/produtos-quimicos/importar', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });

      const dados = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(dados.message || dados.error || `Erro ${res.status} ao processar arquivo.`);
      }

      setRelatorioUpload(dados);
      setArquivoUpload(null);
      carregarProdutos();
    } catch (err) {
      setErroUpload(err.message);
    } finally {
      setEnviandoUpload(false);
    }
  };

  // Dados para Gráficos
  const dadosDonutEnquadramento = useMemo(() => {
    const perigosos = resumo.total_perigosos || 0;
    const naoPerigosos = resumo.total_nao_perigosos || 0;
    if (perigosos === 0 && naoPerigosos === 0) return [];
    return [
      { name: 'Perigoso', valor: perigosos, cor: '#F43F5E' },
      { name: 'Não Perigoso', valor: naoPerigosos, cor: '#10B981' },
    ];
  }, [resumo]);

  const dadosDonutPerigos = useMemo(() => {
    const mp = resumo.matriz_perigos || {};
    const lista = [
      { name: 'Inflamável', valor: mp.inflamavel || 0, cor: CORES_PERIGOS.inflamavel },
      { name: 'Tóxico', valor: mp.toxico || 0, cor: CORES_PERIGOS.toxico },
      { name: 'Corrosivo', valor: mp.corrosivo || 0, cor: CORES_PERIGOS.corrosivo },
      { name: 'Explosivo', valor: mp.explosivo || 0, cor: CORES_PERIGOS.explosivo },
      { name: 'Pirofórico', valor: mp.piroforico || 0, cor: CORES_PERIGOS.piroforico },
      { name: 'Oxidante', valor: mp.oxidante || 0, cor: CORES_PERIGOS.oxidante },
      { name: 'Radioativo', valor: mp.radioativo || 0, cor: CORES_PERIGOS.radioativo },
    ].filter((item) => item.valor > 0);
    return lista;
  }, [resumo]);

  const dadosBarrasLocais = useMemo(() => {
    return (resumo.por_local || []).slice(0, 6).map((item) => ({
      local: item.local.length > 18 ? item.local.substring(0, 18) + '...' : item.local,
      total: item.total,
    }));
  }, [resumo]);

  // Taxa de FISPQ OK
  const taxaFispq = useMemo(() => {
    if (!produtos.length) return 0;
    const ok = produtos.filter((p) => {
      const f = (p.fds_fispq || '').toUpperCase();
      return f.includes('OK') || f.includes('SIM') || f.includes('REGULAR') || f.includes('FDS') || f.includes('FISPQ');
    }).length;
    return Math.round((ok / produtos.length) * 100);
  }, [produtos]);

  return (
    <div className="space-y-6">
      {/* ==================================================================== */}
      {/* 1. CABEÇALHO DA SUB-PÁGINA E AÇÕES PRINCIPAIS                        */}
      {/* ==================================================================== */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between rounded-2xl border border-omega-800 bg-omega-900/90 p-5 shadow-card backdrop-blur-md">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full bg-fuchsia-500/10 px-3 py-1 text-xs font-bold text-fuchsia-400 border border-fuchsia-500/20">
            <FlaskConical size={14} className="text-fuchsia-400" />
            EcoGestão • Módulo Químico & FISPQ
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
            Tratamento de Produtos Químicos
          </h1>
          <p className="text-xs sm:text-sm text-omega-400 max-w-2xl">
            Inventário químico, FDS/FISPQ, matriz de periculosidade, locais de armazenamento e controle de validades.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={carregarProdutos}
            disabled={carregando}
            className="inline-flex items-center gap-2 rounded-xl border border-omega-700 bg-omega-800/80 px-3.5 py-2 text-xs font-semibold text-omega-200 transition-all hover:bg-omega-700 hover:text-white disabled:opacity-50"
            title="Atualizar dados"
          >
            <RefreshCw size={14} className={carregando ? 'animate-spin text-fuchsia-400' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setRelatorioUpload(null);
              setErroUpload(null);
              setArquivoUpload(null);
              setModalImportarAberto(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-3.5 py-2 text-xs font-semibold text-fuchsia-300 transition-all hover:bg-fuchsia-500/20 hover:border-fuchsia-500/50"
          >
            <Upload size={14} />
            <span>+ Importar Planilha</span>
          </button>

          <button
            type="button"
            onClick={abrirCadastroNovo}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-fuchsia-500 px-4 py-2 text-xs font-bold text-white shadow-md shadow-fuchsia-950/40 transition-all hover:from-fuchsia-500 hover:to-fuchsia-400 active:scale-95"
          >
            <Plus size={15} />
            <span>+ Novo Produto</span>
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 2. FILTROS RÁPIDOS E BUSCA                                           */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        {/* Filtro Enquadramento */}
        <div className="md:col-span-4 flex items-center gap-1 p-1 bg-omega-900 border border-omega-800 rounded-xl">
          {[
            { id: 'TODOS', label: 'Todos' },
            { id: 'PERIGOSO', label: 'Perigosos ⚠️' },
            { id: 'NÃO PERIGOSO', label: 'Não Perigosos 🟢' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setFiltroEnquadramento(item.id);
                setPagina(1);
              }}
              className={`flex-1 text-center py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                filtroEnquadramento === item.id
                  ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 shadow-sm'
                  : 'text-omega-400 hover:text-omega-200 hover:bg-omega-800/40'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Filtro por Perigo Específico */}
        <div className="md:col-span-3">
          <select
            value={filtroPerigo}
            onChange={(e) => {
              setFiltroPerigo(e.target.value);
              setPagina(1);
            }}
            className="w-full rounded-xl border border-omega-800 bg-omega-900 px-3 py-2 text-xs text-white focus:border-fuchsia-500 focus:outline-none"
          >
            <option value="TODOS">Todas as Matrizes de Risco</option>
            <option value="inflamavel">🔥 Inflamável</option>
            <option value="toxico">☣️ Tóxico</option>
            <option value="corrosivo">🧪 Corrosivo</option>
            <option value="explosivo">💥 Explosivo</option>
            <option value="piroforico">⚡ Pirofórico</option>
            <option value="oxidante">💨 Oxidante</option>
            <option value="radioativo">☢️ Radioativo</option>
          </select>
        </div>

        {/* Busca textual */}
        <div className="md:col-span-5 relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-omega-500" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por produto, marca, FISPQ, composição ou local..."
            className="w-full rounded-xl border border-omega-800 bg-omega-900 py-2 pl-9 pr-8 text-xs text-white placeholder-omega-500 transition-colors focus:border-fuchsia-500 focus:outline-none"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-omega-500 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 3. CARDS DE INDICADORES (KPIS)                                       */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total de Produtos */}
        <div className="rounded-2xl border border-omega-800 bg-omega-900/80 p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-omega-400">
              Total de Produtos
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20">
              <Package size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-white">
              {fmtNumero(resumo.total_produtos || 0)}
            </span>
            <span className="text-xs text-omega-500">itens catalogados</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400">
            Inventário ativo na operação
          </div>
        </div>

        {/* Produtos Perigosos */}
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-300">
              Produtos Perigosos
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <AlertTriangle size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-rose-400">
              {fmtNumero(resumo.total_perigosos || 0)}
            </span>
            <span className="text-xs text-rose-300/80">
              ({resumo.total_produtos ? Math.round(((resumo.total_perigosos || 0) / resumo.total_produtos) * 100) : 0}%)
            </span>
          </div>
          <div className="mt-2 text-[11px] text-rose-300/70">
            Exigem manuseio e FISPQ controlada
          </div>
        </div>

        {/* FDS / FISPQ Regular */}
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              FDS / FISPQ Regular
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <ShieldCheck size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-emerald-400">
              {taxaFispq}%
            </span>
            <span className="text-xs text-emerald-300/80">conformidade</span>
          </div>
          <div className="mt-2 text-[11px] text-emerald-300/70">
            Fichas disponíveis e catalogadas
          </div>
        </div>

        {/* Validade Crítica */}
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              Validade Crítica
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Clock size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-amber-400">
              {fmtNumero((resumo.total_vencidos || 0) + (resumo.total_a_vencer || 0))}
            </span>
            <span className="text-xs text-amber-300/80">
              ({resumo.total_vencidos || 0} vencidos)
            </span>
          </div>
          <div className="mt-2 text-[11px] text-amber-300/70">
            {resumo.total_a_vencer || 0} a vencer nos próximos 30 dias
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 4. GRÁFICOS ANALÍTICOS (RECHARTS DARK)                               */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Gráfico 1: Enquadramento */}
        <div className="rounded-2xl border border-omega-800 bg-omega-900/90 p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <PieIcon size={14} className="text-fuchsia-400" />
              Classificação de Perigo
            </h3>
            <span className="text-[10px] text-omega-500">Proporção</span>
          </div>
          <div className="h-44">
            {dadosDonutEnquadramento.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie
                    data={dadosDonutEnquadramento}
                    dataKey="valor"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={65}
                    paddingAngle={4}
                  >
                    {dadosDonutEnquadramento.map((entry) => (
                      <Cell key={entry.name} fill={entry.cor} stroke="#0B0F19" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111827',
                      borderColor: '#374151',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(val, name) => [`${val} produtos`, name]}
                  />
                </RechartsPieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-omega-500">
                Nenhum dado catalogado
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-4 text-xs mt-2 border-t border-omega-800/80 pt-2">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              <span className="text-omega-300">Perigosos ({resumo.total_perigosos || 0})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="text-omega-300">Não Perigosos ({resumo.total_nao_perigosos || 0})</span>
            </div>
          </div>
        </div>

        {/* Gráfico 2: Matriz de Riscos */}
        <div className="rounded-2xl border border-omega-800 bg-omega-900/90 p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Flame size={14} className="text-orange-400" />
              Matriz de Riscos Ativos
            </h3>
            <span className="text-[10px] text-omega-500">Flags</span>
          </div>
          <div className="h-44">
            {dadosDonutPerigos.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie
                    data={dadosDonutPerigos}
                    dataKey="valor"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={65}
                    paddingAngle={3}
                  >
                    {dadosDonutPerigos.map((entry) => (
                      <Cell key={entry.name} fill={entry.cor} stroke="#0B0F19" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111827',
                      borderColor: '#374151',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(val, name) => [`${val} produtos`, name]}
                  />
                </RechartsPieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-omega-500">
                Sem matrizes de risco sinalizadas
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] mt-2 border-t border-omega-800/80 pt-2">
            {dadosDonutPerigos.slice(0, 4).map((p) => (
              <span key={p.name} className="flex items-center gap-1 text-omega-300">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.cor }} />
                {p.name}: {p.valor}
              </span>
            ))}
          </div>
        </div>

        {/* Gráfico 3: Distribuição por Local */}
        <div className="rounded-2xl border border-omega-800 bg-omega-900/90 p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Building size={14} className="text-cyan-400" />
              Locais de Armazenamento
            </h3>
            <span className="text-[10px] text-omega-500">Top locais</span>
          </div>
          <div className="h-44">
            {dadosBarrasLocais.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosBarrasLocais} layout="vertical" margin={{ left: 10, right: 10, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" horizontal={false} />
                  <XAxis type="number" stroke="#6B7280" fontSize={10} tickLine={false} />
                  <YAxis type="category" dataKey="local" stroke="#9CA3AF" fontSize={10} width={80} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111827',
                      borderColor: '#374151',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(val) => [`${val} produtos`, 'Total']}
                  />
                  <Bar dataKey="total" fill="#06B6D4" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-omega-500">
                Nenhum local cadastrado
              </div>
            )}
          </div>
          <div className="text-center text-[11px] text-omega-400 mt-2 border-t border-omega-800/80 pt-2">
            Concentração dos estoques operacionais
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 5. TABELA DE PRODUTOS QUÍMICOS                                       */}
      {/* ==================================================================== */}
      <div className="rounded-2xl border border-omega-800 bg-omega-900/90 shadow-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-omega-800">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-fuchsia-400" />
            <h2 className="text-sm font-bold text-white">Inventário de Produtos Químicos</h2>
            <span className="rounded-full bg-omega-800 px-2 py-0.5 text-[10px] font-bold text-omega-300">
              {totalRegistros} {totalRegistros === 1 ? 'registro' : 'registros'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-omega-400">
            <span>Exibir</span>
            <select
              value={limite}
              onChange={(e) => {
                setLimite(Number(e.target.value));
                setPagina(1);
              }}
              className="rounded-lg border border-omega-800 bg-omega-950 px-2 py-1 text-xs text-white focus:border-fuchsia-500 focus:outline-none"
            >
              {TAMANHOS_PAGINA.map((tam) => (
                <option key={tam} value={tam}>
                  {tam}
                </option>
              ))}
            </select>
            <span>por página</span>
          </div>
        </div>

        {/* Tabela com scroll horizontal responsivo */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-omega-950/60 text-[10px] font-bold uppercase tracking-wider text-omega-400 border-b border-omega-800">
              <tr>
                <th className="py-3 px-4">Nome do Produto</th>
                <th className="py-3 px-3">FDS / FISPQ</th>
                <th className="py-3 px-3">Marca / Fabricante</th>
                <th className="py-3 px-3">Composição</th>
                <th className="py-3 px-3">Enquadramento</th>
                <th className="py-3 px-3">Matriz de Riscos</th>
                <th className="py-3 px-3">Validade</th>
                <th className="py-3 px-3">Local de Armazenamento</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-800/60">
              {carregando ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-omega-400">
                    <Loader2 size={24} className="mx-auto mb-2 animate-spin text-fuchsia-400" />
                    Carregando produtos químicos...
                  </td>
                </tr>
              ) : erro ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-rose-400">
                    <AlertCircle size={20} className="mx-auto mb-1 text-rose-400" />
                    {erro}
                  </td>
                </tr>
              ) : produtos.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-omega-400">
                    <FlaskConical size={28} className="mx-auto mb-2 text-omega-600" />
                    Nenhum produto químico encontrado com os filtros atuais.
                  </td>
                </tr>
              ) : (
                produtos.map((prod) => {
                  const bValidade = badgeStatusValidade(prod.validade_produto);
                  const diasRestantes = diasRestantesTexto(prod.validade_produto);

                  // Flags ativas
                  const riscos = [
                    { chave: 'inflamavel', ativo: prod.inflamavel, label: 'Inflamável', icone: Flame, cor: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
                    { chave: 'toxico', ativo: prod.toxico, label: 'Tóxico', icone: AlertOctagon, cor: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
                    { chave: 'corrosivo', ativo: prod.corrosivo, label: 'Corrosivo', icone: FlaskConical, cor: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
                    { chave: 'explosivo', ativo: prod.explosivo, label: 'Explosivo', icone: Bomb, cor: 'bg-red-500/20 text-red-300 border-red-500/40' },
                    { chave: 'piroforico', ativo: prod.piroforico, label: 'Pirofórico', icone: Zap, cor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
                    { chave: 'oxidante', ativo: prod.oxidante, label: 'Oxidante', icone: Wind, cor: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
                    { chave: 'radioativo', ativo: prod.radioativo, label: 'Radioativo', icone: Radio, cor: 'bg-pink-500/20 text-pink-300 border-pink-500/40' },
                  ].filter((r) => r.ativo);

                  const isPerigoso = prod.enquadramento_produto === 'PERIGOSO';

                  return (
                    <tr key={prod.id} className="hover:bg-omega-800/30 transition-colors">
                      {/* Nome do Produto */}
                      <td className="py-3 px-4 font-bold text-white max-w-[220px]">
                        <div className="truncate" title={prod.nome_produto}>
                          {prod.nome_produto}
                        </div>
                      </td>

                      {/* FDS / FISPQ */}
                      <td className="py-3 px-3">
                        {prod.fds_fispq ? (
                          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase bg-omega-800 text-omega-300 border border-omega-700">
                            <FileText size={11} className="text-fuchsia-400" />
                            {prod.fds_fispq}
                          </span>
                        ) : (
                          <span className="text-omega-600">—</span>
                        )}
                      </td>

                      {/* Marca */}
                      <td className="py-3 px-3 text-omega-300 font-medium">
                        {prod.marca_produto || <span className="text-omega-600">—</span>}
                      </td>

                      {/* Composição */}
                      <td className="py-3 px-3 text-omega-400 max-w-[160px] truncate" title={prod.substancias_composicao || ''}>
                        {prod.substancias_composicao || <span className="text-omega-600">—</span>}
                      </td>

                      {/* Enquadramento */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider border ${
                            isPerigoso
                              ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                          }`}
                        >
                          {isPerigoso ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                          {prod.enquadramento_produto}
                        </span>
                      </td>

                      {/* Matriz de Riscos */}
                      <td className="py-3 px-3">
                        {riscos.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {riscos.map((r) => {
                              const IconeRisco = r.icone;
                              return (
                                <span
                                  key={r.chave}
                                  title={r.label}
                                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold border ${r.cor}`}
                                >
                                  <IconeRisco size={10} />
                                  <span>{r.label}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-omega-600 text-[11px]">Nenhum</span>
                        )}
                      </td>

                      {/* Validade */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {prod.validade_produto ? (
                          <div>
                            <div className="text-white font-medium">
                              {formatarDataSemTimezone(prod.validade_produto)}
                            </div>
                            <div className="text-[10px] text-omega-400 flex items-center gap-1 mt-0.5">
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                                bValidade.texto === 'Vencido'
                                  ? 'bg-rose-500'
                                  : bValidade.texto === 'A Vencer'
                                  ? 'bg-amber-400'
                                  : 'bg-emerald-400'
                              }`} />
                              {diasRestantes}
                            </div>
                          </div>
                        ) : (
                          <span className="text-omega-600">Não informada</span>
                        )}
                      </td>

                      {/* Local de Armazenamento */}
                      <td className="py-3 px-3 text-omega-300 max-w-[150px] truncate" title={prod.local_armazenamento || ''}>
                        {prod.local_armazenamento || <span className="text-omega-600">—</span>}
                      </td>

                      {/* Ações */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => abrirEdicao(prod)}
                            className="rounded-lg p-1.5 text-omega-400 hover:bg-omega-800 hover:text-white transition-colors"
                            title="Editar produto"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setProdutoExcluindo(prod);
                              setModalExcluirAberto(true);
                            }}
                            className="rounded-lg p-1.5 text-omega-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                            title="Excluir produto"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-omega-800 bg-omega-950/40 text-xs text-omega-400">
            <div>
              Mostrando{' '}
              <span className="text-white font-bold">
                {produtos.length ? (pagina - 1) * limite + 1 : 0}
              </span>{' '}
              a{' '}
              <span className="text-white font-bold">
                {Math.min(pagina * limite, totalRegistros)}
              </span>{' '}
              de <span className="text-white font-bold">{totalRegistros}</span> produtos
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPagina(1)}
                disabled={pagina === 1}
                className="rounded-lg border border-omega-800 p-1.5 hover:bg-omega-800 hover:text-white disabled:opacity-30"
                title="Primeira página"
              >
                <ChevronsLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={pagina === 1}
                className="rounded-lg border border-omega-800 p-1.5 hover:bg-omega-800 hover:text-white disabled:opacity-30"
                title="Página anterior"
              >
                <ChevronLeft size={14} />
              </button>

              <span className="px-3 py-1 font-bold text-white bg-omega-800 rounded-lg">
                Página {pagina} de {totalPaginas}
              </span>

              <button
                type="button"
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                disabled={pagina === totalPaginas}
                className="rounded-lg border border-omega-800 p-1.5 hover:bg-omega-800 hover:text-white disabled:opacity-30"
                title="Próxima página"
              >
                <ChevronRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => setPagina(totalPaginas)}
                disabled={pagina === totalPaginas}
                className="rounded-lg border border-omega-800 p-1.5 hover:bg-omega-800 hover:text-white disabled:opacity-30"
                title="Última página"
              >
                <ChevronsRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* 6. MODAL DE CADASTRO / EDIÇÃO MANUAL                                 */}
      {/* ==================================================================== */}
      <Modal
        aberto={modalCadastroAberto}
        aoFechar={() => setModalCadastroAberto(false)}
        titulo={produtoEditando ? 'Editar Produto Químico' : 'Cadastrar Novo Produto Químico'}
        subtitulo={
          produtoEditando
            ? 'Altere as especificações químicas, FISPQ e matrizes de perigo.'
            : 'Preencha os dados do produto químico para incluí-lo no inventário da EcoGestão.'
        }
        largura="max-w-2xl"
      >
        <form onSubmit={salvarProduto} className="space-y-4">
          {erroForm && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <span>{erroForm}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Nome do Produto */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-omega-300 uppercase tracking-wider mb-1">
                Nome do Produto Químico *
              </label>
              <input
                type="text"
                required
                value={form.nome_produto}
                onChange={(e) => setForm({ ...form, nome_produto: e.target.value })}
                placeholder="Ex: ACETILENO, BASE PROTETIVA, ÁLCOOL ETÍLICO..."
                className="w-full rounded-xl border border-omega-700 bg-omega-950 px-3.5 py-2.5 text-xs text-white placeholder-omega-500 focus:border-fuchsia-500 focus:outline-none"
              />
            </div>

            {/* FDS / FISPQ */}
            <div>
              <label className="block text-xs font-bold text-omega-300 uppercase tracking-wider mb-1">
                FDS / FISPQ
              </label>
              <input
                type="text"
                value={form.fds_fispq}
                onChange={(e) => setForm({ ...form, fds_fispq: e.target.value })}
                placeholder="Ex: SIM, OK, PENDENTE ou Código"
                className="w-full rounded-xl border border-omega-700 bg-omega-950 px-3.5 py-2.5 text-xs text-white placeholder-omega-500 focus:border-fuchsia-500 focus:outline-none"
              />
              <div className="flex gap-1.5 mt-1.5">
                {['SIM', 'OK', 'PENDENTE', 'NÃO'].map((opcao) => (
                  <button
                    key={opcao}
                    type="button"
                    onClick={() => setForm({ ...form, fds_fispq: opcao })}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-omega-800 text-omega-400 hover:text-white"
                  >
                    {opcao}
                  </button>
                ))}
              </div>
            </div>

            {/* Marca / Fabricante */}
            <div>
              <label className="block text-xs font-bold text-omega-300 uppercase tracking-wider mb-1">
                Marca / Fabricante
              </label>
              <input
                type="text"
                value={form.marca_produto}
                onChange={(e) => setForm({ ...form, marca_produto: e.target.value })}
                placeholder="Ex: BADEN, TEK BOND, WHITE MARTINS"
                className="w-full rounded-xl border border-omega-700 bg-omega-950 px-3.5 py-2.5 text-xs text-white placeholder-omega-500 focus:border-fuchsia-500 focus:outline-none"
              />
            </div>

            {/* Composição */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-omega-300 uppercase tracking-wider mb-1">
                Substâncias da Composição
              </label>
              <input
                type="text"
                value={form.substancias_composicao}
                onChange={(e) => setForm({ ...form, substancias_composicao: e.target.value })}
                placeholder="Ex: MISTURA DE GASES, ÁLCOOL ETÍLICO, SOLVENTES..."
                className="w-full rounded-xl border border-omega-700 bg-omega-950 px-3.5 py-2.5 text-xs text-white placeholder-omega-500 focus:border-fuchsia-500 focus:outline-none"
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {COMPOSICOES_SUGERIDAS.slice(0, 3).map((comp) => (
                  <button
                    key={comp}
                    type="button"
                    onClick={() => setForm({ ...form, substancias_composicao: comp })}
                    className="text-[10px] font-medium px-2 py-0.5 rounded bg-omega-800 text-omega-400 hover:text-white"
                  >
                    {comp}
                  </button>
                ))}
              </div>
            </div>

            {/* Enquadramento */}
            <div>
              <label className="block text-xs font-bold text-omega-300 uppercase tracking-wider mb-1">
                Enquadramento do Produto
              </label>
              <select
                value={form.enquadramento_produto}
                onChange={(e) => setForm({ ...form, enquadramento_produto: e.target.value })}
                className="w-full rounded-xl border border-omega-700 bg-omega-950 px-3.5 py-2.5 text-xs text-white focus:border-fuchsia-500 focus:outline-none"
              >
                <option value="PERIGOSO">⚠️ PERIGOSO</option>
                <option value="NÃO PERIGOSO">🟢 NÃO PERIGOSO</option>
              </select>
            </div>

            {/* Validade */}
            <div>
              <label className="block text-xs font-bold text-omega-300 uppercase tracking-wider mb-1">
                Data de Validade
              </label>
              <input
                type="date"
                value={form.validade_produto}
                onChange={(e) => setForm({ ...form, validade_produto: e.target.value })}
                className="w-full rounded-xl border border-omega-700 bg-omega-950 px-3.5 py-2.5 text-xs text-white focus:border-fuchsia-500 focus:outline-none"
              />
            </div>

            {/* Local de Armazenamento */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-omega-300 uppercase tracking-wider mb-1">
                Local de Armazenamento
              </label>
              <input
                type="text"
                value={form.local_armazenamento}
                onChange={(e) => setForm({ ...form, local_armazenamento: e.target.value })}
                placeholder="Ex: ALMOXARIFADO CENTRAL, CONTAINER QUÍMICO 01..."
                className="w-full rounded-xl border border-omega-700 bg-omega-950 px-3.5 py-2.5 text-xs text-white placeholder-omega-500 focus:border-fuchsia-500 focus:outline-none"
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {LOCAIS_SUGERIDOS.slice(0, 3).map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => setForm({ ...form, local_armazenamento: loc })}
                    className="text-[10px] font-medium px-2 py-0.5 rounded bg-omega-800 text-omega-400 hover:text-white"
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Matriz de Perigos (Checkboxes Interativos) */}
          <div className="rounded-xl border border-omega-800 bg-omega-950/60 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-fuchsia-400 flex items-center gap-1.5">
                <Flame size={14} />
                Matriz de Periculosidade (Flags de Risco)
              </span>
              <span className="text-[10px] text-omega-500">Marque todas as classes aplicáveis</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {[
                { chave: 'inflamavel', label: 'Inflamável', icone: Flame, corAtiva: 'border-orange-500 bg-orange-500/10 text-orange-300' },
                { chave: 'toxico', label: 'Tóxico', icone: AlertOctagon, corAtiva: 'border-purple-500 bg-purple-500/10 text-purple-300' },
                { chave: 'corrosivo', label: 'Corrosivo', icone: FlaskConical, corAtiva: 'border-yellow-500 bg-yellow-500/10 text-yellow-300' },
                { chave: 'explosivo', label: 'Explosivo', icone: Bomb, corAtiva: 'border-red-500 bg-red-500/10 text-red-300' },
                { chave: 'piroforico', label: 'Pirofórico', icone: Zap, corAtiva: 'border-cyan-500 bg-cyan-500/10 text-cyan-300' },
                { chave: 'oxidante', label: 'Oxidante', icone: Wind, corAtiva: 'border-blue-500 bg-blue-500/10 text-blue-300' },
                { chave: 'radioativo', label: 'Radioativo', icone: Radio, corAtiva: 'border-pink-500 bg-pink-500/10 text-pink-300' },
              ].map((item) => {
                const Icone = item.icone;
                const marcado = Boolean(form[item.chave]);
                return (
                  <button
                    key={item.chave}
                    type="button"
                    onClick={() => setForm({ ...form, [item.chave]: !marcado })}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs font-bold transition-all ${
                      marcado
                        ? item.corAtiva
                        : 'border-omega-800 bg-omega-900/40 text-omega-500 hover:border-omega-700'
                    }`}
                  >
                    <Icone size={14} className={marcado ? '' : 'opacity-40'} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Botões do Rodapé */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-omega-800">
            <button
              type="button"
              onClick={() => setModalCadastroAberto(false)}
              className="rounded-xl border border-omega-700 bg-omega-800 px-4 py-2.5 text-xs font-semibold text-omega-300 hover:bg-omega-700 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvandoForm}
              className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-fuchsia-500 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:from-fuchsia-500 hover:to-fuchsia-400 disabled:opacity-50 flex items-center gap-2"
            >
              {salvandoForm && <Loader2 size={14} className="animate-spin" />}
              {produtoEditando ? 'Salvar Alterações' : 'Cadastrar Produto'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================================================================== */}
      {/* 7. MODAL DE IMPORTAÇÃO (DRAG-AND-DROP)                                */}
      {/* ==================================================================== */}
      <Modal
        aberto={modalImportarAberto}
        aoFechar={() => setModalImportarAberto(false)}
        titulo="Importar Planilha de Produtos Químicos"
        subtitulo="Envie uma planilha nos formatos .xlsx, .xls ou .csv com as colunas de produtos, marcas, FISPQ e flags de risco."
        largura="max-w-xl"
      >
        <div className="space-y-4">
          {erroUpload && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <span>{erroUpload}</span>
            </div>
          )}

          {/* Área de Drag and Drop */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
              dragOver
                ? 'border-fuchsia-500 bg-fuchsia-500/10'
                : arquivoUpload
                ? 'border-emerald-500 bg-emerald-500/5'
                : 'border-omega-800 hover:border-omega-700 bg-omega-950/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleSelecionarArquivo}
              className="hidden"
            />

            {arquivoUpload ? (
              <div className="space-y-2">
                <FileSpreadsheet size={36} className="mx-auto text-emerald-400" />
                <div className="text-xs font-bold text-white">{arquivoUpload.name}</div>
                <div className="text-[11px] text-omega-400">
                  {(arquivoUpload.size / (1024 * 1024)).toFixed(2)} MB • Clique para trocar
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <FileUp size={36} className="mx-auto text-fuchsia-400" />
                <div className="text-xs font-bold text-white">
                  Arraste e solte sua planilha aqui, ou{' '}
                  <span className="text-fuchsia-400 underline">procure no computador</span>
                </div>
                <div className="text-[11px] text-omega-500">
                  Formatos aceitos: .xlsx, .xls ou .csv (até 25 MB)
                </div>
              </div>
            )}
          </div>

          {/* Relatório Pós-Importação */}
          {relatorioUpload && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                <CheckCircle2 size={16} />
                Importação concluída com sucesso!
              </div>
              <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-emerald-500/20 text-xs">
                <div>
                  <div className="text-emerald-300 font-bold">{relatorioUpload.total_lidos || 0}</div>
                  <div className="text-[10px] text-omega-400">Processados</div>
                </div>
                <div>
                  <div className="text-emerald-400 font-bold">{relatorioUpload.importados || 0}</div>
                  <div className="text-[10px] text-omega-400">Inseridos</div>
                </div>
                <div>
                  <div className="text-amber-400 font-bold">{relatorioUpload.duplicados_ignorados || 0}</div>
                  <div className="text-[10px] text-omega-400">Duplicados</div>
                </div>
              </div>

              {relatorioUpload.matriz_perigos && (
                <div className="text-[10px] text-omega-300 border-t border-emerald-500/20 pt-2 flex flex-wrap gap-2 justify-center">
                  <span>🔥 Inflamáveis: {relatorioUpload.matriz_perigos.inflamavel}</span>
                  <span>☣️ Tóxicos: {relatorioUpload.matriz_perigos.toxico}</span>
                  <span>🧪 Corrosivos: {relatorioUpload.matriz_perigos.corrosivo}</span>
                  <span>💥 Explosivos: {relatorioUpload.matriz_perigos.explosivo}</span>
                </div>
              )}
            </div>
          )}

          {/* Botões do Rodapé */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-omega-800">
            <button
              type="button"
              onClick={() => setModalImportarAberto(false)}
              className="rounded-xl border border-omega-700 bg-omega-800 px-4 py-2.5 text-xs font-semibold text-omega-300 hover:bg-omega-700 hover:text-white"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={enviarPlanilha}
              disabled={!arquivoUpload || enviandoUpload}
              className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-fuchsia-500 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:from-fuchsia-500 hover:to-fuchsia-400 disabled:opacity-50 flex items-center gap-2"
            >
              {enviandoUpload && <Loader2 size={14} className="animate-spin" />}
              {enviandoUpload ? 'Processando Planilha...' : 'Confirmar Importação'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ==================================================================== */}
      {/* 8. MODAL DE EXCLUSÃO                                                 */}
      {/* ==================================================================== */}
      <Modal
        aberto={modalExcluirAberto}
        aoFechar={() => setModalExcluirAberto(false)}
        titulo="Excluir Produto Químico"
        subtitulo="Esta ação removerá o produto do catálogo da EcoGestão permanentemente."
        largura="max-w-md"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300 flex items-start gap-2.5">
            <AlertTriangle size={18} className="shrink-0 text-rose-400 mt-0.5" />
            <div>
              Você tem certeza que deseja remover o produto{' '}
              <strong className="text-white">{produtoExcluindo?.nome_produto}</strong>?
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-omega-800">
            <button
              type="button"
              onClick={() => setModalExcluirAberto(false)}
              className="rounded-xl border border-omega-700 bg-omega-800 px-4 py-2 text-xs font-semibold text-omega-300 hover:bg-omega-700 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmarExclusao}
              className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500"
            >
              Sim, Excluir
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
