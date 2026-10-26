// ============================================================================
// frontend/src/views/ConsumoAguaView.jsx — Consumo de Água Potável (EcoGestão).
//
// Sub-módulo para monitoramento volumétrico de captação, hidrômetros,
// média diária, pico de consumo (m³), série temporal diária (Recharts),
// distribuição por ponto de captação (Donut), importação de planilhas
// e cadastro/edição manual de medições.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Droplets,
  Edit2,
  FileSpreadsheet,
  FileUp,
  Filter,
  Layers,
  Loader2,
  PieChart as PieIcon,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
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

const CORES_PONTOS = [
  '#0EA5E9', // Sky/Azul Água
  '#06B6D4', // Cyan
  '#10B981', // Emerald
  '#6366F1', // Indigo
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#8B5CF6', // Purple
];

const PONTOS_SUGERIDOS = [
  'ETA',
  'ETA / HIDRÔMETRO',
  'POÇO ARTESIANO',
  'CAMINHÃO PIPA',
  'REDE PÚBLICA',
  'RESERVATÓRIO CENTRAL',
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

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

// ============================================================================
// COMPONENTE: MODAL DE IMPORTAÇÃO (DRAG-AND-DROP)
// ============================================================================
function ModalImportacaoAgua({ onClose, onImportado }) {
  const inputRef = useRef(null);
  const [arrastando, setArrastando] = useState(false);
  const [arquivo, setArquivo] = useState(null);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState(null);
  const [resultado, setResultado] = useState(null);

  const escolherArquivo = (file) => {
    if (!file) return;
    if (!EXTENSOES_ACEITAS.test(file.name)) {
      setErro('Formato inválido. Envie uma planilha .xlsx, .xls ou .csv.');
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

      const resp = await fetch('/api/ecogestao/agua/importar', {
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
      setErro(err?.message || 'Não foi possível importar a planilha.');
    } finally {
      setImportando(false);
    }
  };

  const resumo = resultado?.resumo || {};
  const importados = Number(resumo.importados) || 0;
  const duplicados = Number(resumo.duplicados_ignorados) || 0;
  const totalM3 = Number(resumo.total_consumo_m3) || 0;
  const avisos = Array.isArray(resultado?.avisos) ? resultado.avisos : [];

  const rodape = resultado ? (
    <>
      <button type="button" onClick={limpar} className="btn-secondary text-xs">
        <FileUp size={14} />
        Importar outra
      </button>
      <button type="button" onClick={onClose} className="btn-primary text-xs !bg-cyan-600 hover:!bg-cyan-700">
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
        form="form-importar-agua"
        disabled={!arquivo || importando}
        className="btn text-xs bg-cyan-600 text-white hover:bg-cyan-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
      title="Importar Medições de Consumo de Água"
      subtitle="Envie a planilha de monitoramento de hidrômetros em .xlsx, .xls ou .csv (até 25 MB)."
      size="lg"
      footer={rodape}
    >
      {resultado ? (
        <div className="space-y-4">
          <div
            className={`rounded-xl border p-4 ${
              importados > 0
                ? 'border-cyan-500/30 bg-cyan-950/20 text-cyan-200'
                : 'border-amber-500/30 bg-amber-950/20 text-amber-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {importados > 0 ? (
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-cyan-400" />
              ) : (
                <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-400" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-bold text-white">
                  {resultado.mensagem || 'Processamento concluído com sucesso!'}
                </div>
                <div className="text-xs text-omega-300 mt-1">
                  Os registros de consumo foram validados, deduplicados e consolidados no banco de dados.
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-omega-800 bg-omega-900/60 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Inseridos</div>
              <div className="text-xl font-black text-cyan-400 tabular-nums mt-0.5">{fmtNumero(importados)}</div>
            </div>
            <div className="rounded-xl border border-omega-800 bg-omega-900/60 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Duplicados</div>
              <div className="text-xl font-black text-amber-400 tabular-nums mt-0.5">{fmtNumero(duplicados)}</div>
            </div>
            <div className="rounded-xl border border-omega-800 bg-omega-900/60 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Total (m³)</div>
              <div className="text-xl font-black text-white tabular-nums mt-0.5">{fmtNumero(totalM3, 1)}</div>
            </div>
            <div className="rounded-xl border border-omega-800 bg-omega-900/60 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Meses</div>
              <div className="text-xl font-black text-emerald-400 tabular-nums mt-0.5">{resumo.meses_afetados?.length || 0}</div>
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
        <form id="form-importar-agua" onSubmit={importar} className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={aoSoltar}
            onClick={() => inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-150 ${
              arrastando
                ? 'border-cyan-500 bg-cyan-500/10 scale-[0.99]'
                : 'border-omega-700 bg-omega-900/40 hover:border-cyan-500/60 hover:bg-omega-900/80'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => escolherArquivo(e.target.files?.[0])}
            />

            <div className="w-14 h-14 rounded-2xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center mb-3 shadow-inner">
              <Droplets size={28} />
            </div>

            <div className="text-sm font-bold text-white text-center">
              {arquivo ? (
                <span className="text-cyan-400">{arquivo.name}</span>
              ) : (
                <>Arraste sua planilha aqui ou <span className="text-cyan-400 underline">clique para selecionar</span></>
              )}
            </div>

            <div className="text-xs text-omega-400 mt-1 text-center">
              Formatos aceitos: .xlsx, .xls ou .csv (até 25 MB)
            </div>

            {arquivo && (
              <div className="mt-3 flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-omega-300">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                {(arquivo.size / (1024 * 1024)).toFixed(2)} MB selecionado
              </div>
            )}
          </div>

          <div className="rounded-xl border border-omega-800 bg-omega-900/40 p-3.5 text-xs text-omega-400 space-y-1.5">
            <div className="font-bold text-omega-200 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Layers size={13} className="text-cyan-400" /> Colunas Reconhecidas Automaticamente
            </div>
            <p className="text-[11px] leading-relaxed">
              O importador reconhece variações de cabeçalhos como:
              <br />
              • <strong className="text-omega-300">Data:</strong> DATA, DATA DA MEDIÇÃO, DATA LEITURA, DIA
              <br />
              • <strong className="text-omega-300">Ponto de Captação:</strong> PONTOS DE CAPTAÇÃO, PONTO, ETA, HIDRÔMETRO, LOCAL
              <br />
              • <strong className="text-omega-300">Consumo (m³):</strong> CONSUMO (M3), VOLUME (M3), CONSUMO M3, M3, QUANTIDADE
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
// COMPONENTE: MODAL DE CADASTRO / EDIÇÃO MANUAL
// ============================================================================
function ModalRegistroAgua({ itemEdicao, onClose, onSalvo }) {
  const isEdicao = Boolean(itemEdicao?.id);

  const [data, setData] = useState(() => (itemEdicao?.data ? paraInputData(itemEdicao.data) : hojeISO()));
  const [pontosCaptacao, setPontosCaptacao] = useState(() => itemEdicao?.pontos_captacao || '');
  const [consumoM3, setConsumoM3] = useState(() => (itemEdicao?.consumo_m3 !== undefined ? String(itemEdicao.consumo_m3) : ''));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const salvar = async (e) => {
    e.preventDefault();
    setErro(null);

    if (!data) {
      setErro('A data da medição é obrigatória.');
      return;
    }
    if (!pontosCaptacao.trim()) {
      setErro('Informe o ponto de captação (ex: ETA, ETA / HIDRÔMETRO).');
      return;
    }
    const volNum = Number(consumoM3.replace(',', '.'));
    if (!Number.isFinite(volNum) || volNum < 0) {
      setErro('Informe um volume válido em m³ (positivo).');
      return;
    }

    setSalvando(true);
    try {
      const url = isEdicao
        ? `/api/ecogestao/agua/${itemEdicao.id}`
        : '/api/ecogestao/agua';
      const method = isEdicao ? 'PUT' : 'POST';

      const resp = await fetch(url, {
        method,
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data,
          pontos_captacao: pontosCaptacao.trim().toUpperCase(),
          consumo_m3: volNum,
        }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.message || `Erro ao salvar registro (HTTP ${resp.status}).`);
      }

      onSalvo?.();
      onClose();
    } catch (err) {
      setErro(err?.message || 'Falha ao salvar medição.');
    } finally {
      setSalvando(false);
    }
  };

  const rodape = (
    <>
      <button
        type="button"
        onClick={onClose}
        disabled={salvando}
        className="btn-secondary text-xs disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        type="submit"
        form="form-registro-agua"
        disabled={salvando}
        className="btn text-xs bg-cyan-600 text-white hover:bg-cyan-700 shadow-sm disabled:opacity-50"
      >
        {salvando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        {salvando ? 'Salvando...' : isEdicao ? 'Salvar alterações' : 'Cadastrar medição'}
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdicao ? 'Editar Medição de Água' : 'Nova Medição de Água Potável'}
      subtitle="Preencha a data, o ponto de captação monitorado e o volume consumido em m³."
      size="md"
      footer={rodape}
    >
      <form id="form-registro-agua" onSubmit={salvar} className="space-y-4">
        {erro && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 flex items-start gap-2.5 text-xs text-rose-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-400" />
            <span>{erro}</span>
          </div>
        )}

        <div>
          <label className="label text-xs text-omega-300">Data da Medição *</label>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            required
            className="input text-xs bg-omega-950 border-omega-700 text-white"
          />
        </div>

        <div>
          <label className="label text-xs text-omega-300">Ponto de Captação *</label>
          <input
            type="text"
            value={pontosCaptacao}
            onChange={(e) => setPontosCaptacao(e.target.value)}
            placeholder="Ex: ETA, ETA / HIDRÔMETRO, POÇO ARTESIANO"
            required
            className="input text-xs bg-omega-950 border-omega-700 text-white placeholder-omega-500"
          />

          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="text-[10px] text-omega-500 self-center mr-1">Sugestões:</span>
            {PONTOS_SUGERIDOS.map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => setPontosCaptacao(sug)}
                className="rounded-full bg-omega-800 hover:bg-cyan-950 hover:text-cyan-300 border border-omega-700/60 px-2 py-0.5 text-[10px] font-medium text-omega-300 transition-colors"
              >
                {sug}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label text-xs text-omega-300">Volume Consumido (m³) *</label>
          <div className="relative">
            <input
              type="number"
              step="0.001"
              min="0"
              value={consumoM3}
              onChange={(e) => setConsumoM3(e.target.value)}
              placeholder="0.000"
              required
              className="input text-xs bg-omega-950 border-omega-700 text-white placeholder-omega-500 pr-12 font-bold tabular-nums"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-cyan-400">
              m³
            </span>
          </div>
          <span className="text-[10px] text-omega-500 mt-1 block">
            1 m³ equivale a 1.000 litros de água potável.
          </span>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL: CONSUMO DE ÁGUA VIEW
// ============================================================================
export default function ConsumoAguaView() {
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState(null);

  // Filtros
  const [mesesDisponiveis, setMesesDisponiveis] = useState([]);
  const [anoMesSelecionado, setAnoMesSelecionado] = useState('');
  const [filtroPonto, setFiltroPonto] = useState('TODOS');
  const [busca, setBusca] = useState('');

  // Dados
  const [registros, setRegistros] = useState([]);
  const [resumo, setResumo] = useState({
    total_registros: 0,
    total_consumo_m3: 0,
    media_diaria_m3: 0,
    pico_consumo_m3: 0,
    ponto_pico: null,
    data_pico: null,
    menor_consumo_m3: 0,
    dias_monitorados: 0,
    distribuicao_por_ponto: [],
    consumo_diario: [],
  });

  // Modais
  const [modalImportacao, setModalImportacao] = useState(false);
  const [modalFormulario, setModalFormulario] = useState(false);
  const [itemEdicao, setItemEdicao] = useState(null);

  // Paginação
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  // Carrega meses com registros
  const carregarMeses = useCallback(async () => {
    try {
      const resp = await fetch('/api/ecogestao/agua/meses', {
        headers: authHeaders(),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const lista = Array.isArray(data?.meses) ? data.meses : [];
      setMesesDisponiveis(lista);

      if (lista.length > 0) {
        setAnoMesSelecionado((prev) => (prev ? prev : lista[0].ano_mes));
      }
    } catch (e) {
      console.error('Erro ao carregar meses de água:', e);
    }
  }, []);

  // Carrega medições de água
  const carregarDados = useCallback(async (isRefresh = false) => {
    if (isRefresh) setAtualizando(true);
    else setCarregando(true);
    setErro(null);

    try {
      const params = new URLSearchParams();
      if (anoMesSelecionado && anoMesSelecionado !== 'TODOS') {
        params.append('ano_mes', anoMesSelecionado);
      }
      params.append('limite', '1000');

      const resp = await fetch(`/api/ecogestao/agua?${params.toString()}`, {
        headers: authHeaders(),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body?.message || `Erro ao carregar medições de água (HTTP ${resp.status}).`);
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
  }, [anoMesSelecionado]);

  useEffect(() => {
    carregarMeses();
  }, [carregarMeses]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Lista única de pontos para o filtro
  const pontosDisponiveis = useMemo(() => {
    const set = new Set();
    registros.forEach((r) => {
      if (r.pontos_captacao) set.add(r.pontos_captacao.toUpperCase());
    });
    return Array.from(set).sort();
  }, [registros]);

  // Filtragem client-side
  const registrosFiltrados = useMemo(() => {
    return registros.filter((item) => {
      if (filtroPonto !== 'TODOS') {
        const ponto = String(item.pontos_captacao || '').toUpperCase();
        if (ponto !== filtroPonto) return false;
      }

      if (busca.trim()) {
        const termo = busca.toLowerCase().trim();
        const ponto = String(item.pontos_captacao || '').toLowerCase();
        const mes = String(item.ano_mes || '').toLowerCase();
        return ponto.includes(termo) || mes.includes(termo);
      }

      return true;
    });
  }, [registros, filtroPonto, busca]);

  // Paginação
  const totalPaginas = Math.max(1, Math.ceil(registrosFiltrados.length / porPagina));
  const inicioIndex = (pagina - 1) * porPagina;
  const fimIndex = Math.min(inicioIndex + porPagina, registrosFiltrados.length);
  const registrosPaginados = useMemo(() => {
    return registrosFiltrados.slice(inicioIndex, fimIndex);
  }, [registrosFiltrados, inicioIndex, fimIndex]);

  // Dados para o Gráfico Donut de Pontos de Captação
  const dadosDonut = useMemo(() => {
    if (!resumo.distribuicao_por_ponto || resumo.distribuicao_por_ponto.length === 0) return [];
    return resumo.distribuicao_por_ponto.map((d, index) => ({
      name: d.ponto,
      valor: d.total_m3,
      percentual: d.percentual,
      registros: d.registros,
      cor: CORES_PONTOS[index % CORES_PONTOS.length],
    }));
  }, [resumo.distribuicao_por_ponto]);

  // Dados para o Gráfico de Área / Série Temporal Diária
  const dadosSerieDiaria = useMemo(() => {
    if (!resumo.consumo_diario || resumo.consumo_diario.length === 0) return [];
    return resumo.consumo_diario.map((d) => {
      // Converte YYYY-MM-DD para DD/MM
      const partes = d.data.split('-');
      const diaFormatado = partes.length === 3 ? `${partes[2]}/${partes[1]}` : d.data;
      return {
        dia: diaFormatado,
        consumo: d.consumo_m3,
      };
    });
  }, [resumo.consumo_diario]);

  // Exclusão de registro com confirmação
  const excluirRegistro = async (id) => {
    if (!window.confirm('Tem certeza que deseja excluir esta medição de consumo de água?')) return;

    try {
      const resp = await fetch(`/api/ecogestao/agua/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error(json?.message || 'Falha ao excluir medição.');
      }
      carregarDados(true);
      carregarMeses();
    } catch (e) {
      alert(e.message);
    }
  };

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
          <div className="flex items-center gap-2 text-xs font-bold text-cyan-400 uppercase tracking-widest">
            <Droplets size={15} className="text-cyan-400" />
            EcoGestão • Recursos Hídricos
          </div>
          <h1 className="mt-1 text-2xl font-black text-white tracking-tight sm:text-3xl flex items-center gap-2.5">
            Consumo de Água Potável
            <span className="rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2.5 py-0.5 text-xs font-bold text-cyan-400">
              Hidrometria
            </span>
          </h1>
          <p className="mt-1 text-xs text-omega-300 sm:text-sm max-w-2xl">
            Monitoramento volumétrico de captação, hidrômetros, média diária e picos de consumo (m³).
          </p>
        </div>

        {/* Controles: Seletor de Mês, Atualizar, Novo Registro e Importar */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Seletor de Ano/Mês */}
          <div className="relative">
            <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
            <select
              value={anoMesSelecionado}
              onChange={(e) => setAnoMesSelecionado(e.target.value)}
              className="input !w-auto !py-2 pl-9 pr-8 text-xs font-bold bg-omega-900 border-omega-700 text-white focus:border-cyan-500"
              aria-label="Selecionar Ano/Mês"
            >
              {mesesDisponiveis.length === 0 ? (
                <option value="">Nenhum mês importado</option>
              ) : (
                <>
                  <option value="TODOS">Todos os meses</option>
                  {mesesDisponiveis.map((m) => (
                    <option key={m.ano_mes} value={m.ano_mes}>
                      {m.ano_mes} ({fmtNumero(m.total_consumo_m3, 0)} m³)
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
            <RefreshCw size={14} className={atualizando ? 'animate-spin text-cyan-400' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>

          {/* Botão + Novo Registro */}
          <button
            type="button"
            onClick={() => { setItemEdicao(null); setModalFormulario(true); }}
            className="btn-secondary !bg-omega-800 !border-omega-700 !text-white hover:!bg-omega-700 text-xs px-3.5 py-2 flex items-center gap-1.5"
          >
            <Plus size={14} className="text-cyan-400" />
            <span>+ Novo Registro</span>
          </button>

          {/* Botão + Importar Planilha */}
          <button
            type="button"
            onClick={() => setModalImportacao(true)}
            className="btn text-xs font-bold bg-cyan-600 text-white hover:bg-cyan-500 shadow-md shadow-cyan-950/40 px-3.5 py-2 flex items-center gap-1.5 transition-all duration-150"
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
        {/* Card 1: Consumo Total (m³) */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-cyan-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-500 to-sky-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400">
              <Droplets size={20} />
            </span>
            <span className="rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-0.5 text-[10px] font-black text-cyan-300 uppercase tracking-wider">
              Consumo
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Consumo Total
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white sm:text-3xl tabular-nums tracking-tight">
              {fmtNumero(resumo.total_consumo_m3, 1)}
            </span>
            <span className="text-xs font-bold text-cyan-400">m³</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400">
            Equivalente a <strong className="text-white">{fmtNumero(resumo.total_consumo_m3 * 1000, 0)}</strong> litros
          </div>
        </div>

        {/* Card 2: Média Diária (m³/dia) */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-emerald-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Activity size={20} />
            </span>
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-black text-emerald-300 uppercase tracking-wider">
              Média
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Média Diária
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white sm:text-3xl tabular-nums tracking-tight">
              {fmtNumero(resumo.media_diaria_m3, 2)}
            </span>
            <span className="text-xs font-bold text-emerald-400">m³/dia</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400">
            Consumo médio nos dias monitorados
          </div>
        </div>

        {/* Card 3: Pico de Consumo (m³) */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-amber-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-orange-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <Zap size={20} />
            </span>
            <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[10px] font-black text-amber-300 uppercase tracking-wider">
              Pico
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Pico de Consumo
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white sm:text-3xl tabular-nums tracking-tight">
              {fmtNumero(resumo.pico_consumo_m3, 1)}
            </span>
            <span className="text-xs font-bold text-amber-400">m³</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400 truncate">
            {resumo.ponto_pico ? (
              <span>{resumo.ponto_pico} ({formatarDataSemTimezone(resumo.data_pico)})</span>
            ) : (
              'Nenhum pico registrado'
            )}
          </div>
        </div>

        {/* Card 4: Dias Monitorados */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-violet-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 to-purple-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
              <CalendarDays size={20} />
            </span>
            <span className="rounded-full bg-violet-500/10 border border-violet-500/20 px-2.5 py-0.5 text-[10px] font-black text-violet-300 uppercase tracking-wider">
              Monitoramento
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Dias Monitorados
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white sm:text-3xl tabular-nums tracking-tight">
              {resumo.dias_monitorados}
            </span>
            <span className="text-xs font-bold text-violet-400">dias</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400">
            Total de {fmtNumero(resumo.total_registros)} leituras de hidrômetro
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 3. GRÁFICOS ANALÍTICOS (RECHARTS TEMA DARK)                          */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico 1: Evolução Diária do Consumo (Área / Barras) - Col 2 */}
        <div className="lg:col-span-2 rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card">
          <div className="flex items-center justify-between pb-4 border-b border-omega-800">
            <div>
              <div className="text-sm font-extrabold text-white flex items-center gap-2">
                <Waves size={16} className="text-cyan-400" />
                Série Temporal Diária de Consumo
              </div>
              <div className="text-xs text-omega-400 mt-0.5">
                Volume diário em m³ ao longo do mês selecionado.
              </div>
            </div>
            <div className="text-xs text-omega-400 font-bold">
              {dadosSerieDiaria.length} dia(s) com medição
            </div>
          </div>

          <div className="mt-4 h-64 w-full">
            {dadosSerieDiaria.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-omega-500 text-xs">
                <Waves size={32} className="mb-2 opacity-40 text-omega-600" />
                Nenhum dado diário registrado no período para exibir.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dadosSerieDiaria} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="corAgua" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                  <XAxis
                    dataKey="dia"
                    stroke="#64748B"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                  />
                  <YAxis
                    stroke="#64748B"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                    tickFormatter={(v) => `${fmtVolume(v)} m³`}
                  />
                  <Tooltip
                    cursor={{ stroke: '#0EA5E9', strokeWidth: 1, strokeDasharray: '3 3' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-xl border border-omega-700 bg-omega-950 p-3 shadow-2xl text-xs">
                          <div className="font-bold text-white mb-1.5 border-b border-omega-800 pb-1 flex items-center gap-1.5">
                            <CalendarDays size={13} className="text-cyan-400" /> Dia: {d.dia}
                          </div>
                          <div className="flex items-center justify-between gap-4 text-cyan-400 font-medium">
                            <span>Consumo:</span>
                            <strong className="font-black tabular-nums">{fmtNumero(d.consumo, 2)} m³</strong>
                          </div>
                          <div className="text-[10px] text-omega-400 mt-1">
                            {fmtNumero(d.consumo * 1000, 0)} Litros
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="consumo"
                    stroke="#0EA5E9"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#corAgua)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Gráfico 2: Proporção por Ponto de Captação (Donut) - Col 1 */}
        <div className="rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card flex flex-col justify-between">
          <div className="pb-4 border-b border-omega-800">
            <div className="text-sm font-extrabold text-white flex items-center gap-2">
              <PieIcon size={16} className="text-cyan-400" />
              Pontos de Captação
            </div>
            <div className="text-xs text-omega-400 mt-0.5">
              Distribuição percentual do consumo por origem.
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
                            Volume: <strong className="text-white tabular-nums">{fmtNumero(item.valor, 2)} m³</strong>
                          </div>
                          <div className="text-cyan-400 font-bold">
                            Proporção: {item.percentual}% ({item.registros} leituras)
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

            {dadosDonut.length > 0 && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Total</span>
                <span className="text-sm font-black text-white tabular-nums">
                  {fmtVolume(resumo.total_consumo_m3)} m³
                </span>
              </div>
            )}
          </div>

          {/* Legenda Customizada */}
          <div className="pt-3 border-t border-omega-800 space-y-2 max-h-36 overflow-y-auto pr-1">
            {dadosDonut.map((d) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-omega-300 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.cor }} />
                  <span className="font-bold truncate" title={d.name}>{d.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-black text-white tabular-nums">{fmtNumero(d.valor, 1)} m³</span>
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
              <FileSpreadsheet size={16} className="text-cyan-400" />
              Inventário de Medições de Hidrômetros
            </div>
            <div className="text-xs text-omega-400 mt-0.5">
              Leituras registradas de captação e consumo de água potável.
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
                placeholder="Buscar ponto de captação..."
                className="input !py-1.5 pl-8 pr-7 text-xs bg-omega-950 border-omega-700 text-white placeholder-omega-500 focus:border-cyan-500 w-full"
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

            {/* Filtro por Ponto de Captação */}
            <div className="relative">
              <Filter size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-omega-400" />
              <select
                value={filtroPonto}
                onChange={(e) => { setFiltroPonto(e.target.value); setPagina(1); }}
                className="input !w-auto !py-1.5 pl-8 text-xs font-bold bg-omega-950 border-omega-700 text-white focus:border-cyan-500"
              >
                <option value="TODOS">Todos os Pontos</option>
                {pontosDisponiveis.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Informações de registros filtrados */}
        <div className="px-4 py-2 bg-omega-950/60 border-b border-omega-800 text-[11px] text-omega-400 flex items-center justify-between">
          <span>
            Exibindo <strong className="text-white font-bold">{registrosFiltrados.length}</strong> de{' '}
            <strong className="text-white font-bold">{registros.length}</strong> medições no mês
            {(busca || filtroPonto !== 'TODOS') && (
              <span className="ml-2 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 text-[9px] font-bold uppercase">
                filtro ativo
              </span>
            )}
          </span>
          <span className="font-bold text-omega-300">
            Total filtrado: {fmtNumero(registrosFiltrados.reduce((acc, r) => acc + (r.consumo_m3 || 0), 0), 2)} m³
          </span>
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-omega-800 bg-omega-950/40 text-[10px] font-extrabold uppercase tracking-wider text-omega-400">
                <th className="py-3 px-4">Ano/Mês</th>
                <th className="py-3 px-4">Data</th>
                <th className="py-3 px-4">Ponto de Captação</th>
                <th className="py-3 px-4 text-right">Consumo (m³)</th>
                <th className="py-3 px-4 text-right">Litros (L)</th>
                <th className="py-3 px-4">Última Atualização</th>
                <th className="py-3 px-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-800/60">
              {carregando ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-omega-400">
                    <Loader2 size={24} className="mx-auto mb-2 animate-spin text-cyan-400" />
                    Carregando medições de consumo de água...
                  </td>
                </tr>
              ) : registrosPaginados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-omega-400">
                    <Waves size={28} className="mx-auto mb-2 opacity-30 text-omega-600" />
                    Nenhuma medição encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                registrosPaginados.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-omega-800/40 transition-colors duration-100 group"
                  >
                    {/* Ano/Mês */}
                    <td className="py-3 px-4 font-mono text-[11px] text-omega-400 whitespace-nowrap">
                      {item.ano_mes || '—'}
                    </td>

                    {/* Data */}
                    <td className="py-3 px-4 font-bold text-omega-200 whitespace-nowrap">
                      {formatarDataSemTimezone(item.data)}
                    </td>

                    {/* Ponto de Captação */}
                    <td className="py-3 px-4 font-extrabold text-white">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                          {item.pontos_captacao}
                        </span>
                      </div>
                    </td>

                    {/* Consumo (m³) */}
                    <td className="py-3 px-4 text-right font-black tabular-nums text-white text-sm">
                      {fmtNumero(item.consumo_m3, 2)}{' '}
                      <span className="text-[10px] font-bold text-cyan-400">m³</span>
                    </td>

                    {/* Volume em Litros */}
                    <td className="py-3 px-4 text-right font-bold tabular-nums text-omega-300 text-xs">
                      {fmtNumero(item.consumo_m3 * 1000, 0)}{' '}
                      <span className="text-[10px] font-medium text-omega-500">L</span>
                    </td>

                    {/* Última Atualização */}
                    <td className="py-3 px-4 text-[11px] text-omega-400 whitespace-nowrap">
                      {formatarDataHora(item.ultima_atualizacao || item.created_at)}
                    </td>

                    {/* Ações */}
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setItemEdicao(item); setModalFormulario(true); }}
                          className="p-1 rounded hover:bg-omega-800 text-omega-400 hover:text-cyan-300 transition-colors"
                          title="Editar medição"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => excluirRegistro(item.id)}
                          className="p-1 rounded hover:bg-omega-800 text-omega-400 hover:text-rose-400 transition-colors"
                          title="Excluir medição"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
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
        <ModalImportacaoAgua
          onClose={() => setModalImportacao(false)}
          onImportado={aoImportar}
        />
      )}

      {/* Modal de Cadastro / Edição Manual */}
      {modalFormulario && (
        <ModalRegistroAgua
          itemEdicao={itemEdicao}
          onClose={() => { setModalFormulario(false); setItemEdicao(null); }}
          onSalvo={() => { carregarDados(true); carregarMeses(); }}
        />
      )}
    </div>
  );
}
