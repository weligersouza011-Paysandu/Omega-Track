// ============================================================================
// frontend/src/views/AtosAutorizativosView.jsx — Atos Autorizativos & Licenças.
//
// Sub-módulo para controle e conformidade legal de licenças, alvarás,
// certificados ambientais, condicionantes e rastreabilidade de prestadores.
// Inclui Farol de Vencimentos em tempo real, KPIs de conformidade, gráficos
// Recharts, inventário com busca/paginação e modais de importação e edição.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Award,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Edit2,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FileUp,
  Filter,
  Layers,
  Loader2,
  PieChart as PieIcon,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  ShieldCheck,
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
import { formatarDataSemTimezone, hojeISO, paraInputData } from '../utils/datas.js';
import { gerarModeloAtos } from '../utils/geradorPlanilhaModelo.js';

const TAMANHO_MAXIMO_ARQUIVO = 25 * 1024 * 1024;
const EXTENSOES_ACEITAS = /\.(xlsx|xls|csv)$/i;

const CORES_FAROL = {
  Normal: '#10B981',   // Verde esmeralda
  'A Vencer': '#F59E0B', // Âmbar/Laranja
  Vencido: '#EF4444',  // Vermelho
};

const SERVICOS_SUGERIDOS = [
  'POSTO PARAUAPEBAS LTDA',
  'OMEGA SERVICE',
  'CIPERPRAG',
  'VALE S.A.',
  'DESTINAÇÃO AMBIENTAL',
  'LABORATÓRIO DE ANÁLISES',
];

const TIPOS_LICENCA_SUGERIDOS = [
  'LICENÇA DE OPERAÇÃO (LO)',
  'LICENÇA DE INSTALAÇÃO (LI)',
  'ALVARÁ DE FUNCIONAMENTO',
  'CERTIFICADO DE REGULARIDADE CFT/CREA',
  'AUTORIZAÇÃO AMBIENTAL ANP',
  'OUTORGA DE USO DE ÁGUA',
  'CADASTRO TÉCNICO FEDERAL (CTF/IBAMA)',
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

  const anoV = val.getUTCFullYear();
  const mesV = val.getUTCMonth();
  const diaV = val.getUTCDate();
  const dVal = new Date(Date.UTC(anoV, mesV, diaV));

  const anoH = hoje.getUTCFullYear();
  const mesH = hoje.getUTCMonth();
  const diaH = hoje.getUTCDate();
  const dHoje = new Date(Date.UTC(anoH, mesH, diaH));

  const diffMs = dVal.getTime() - dHoje.getTime();
  const dias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (dias < 0) {
    const dPos = Math.abs(dias);
    return `Vencido há ${dPos} dia${dPos > 1 ? 's' : ''}`;
  }
  if (dias === 0) {
    return 'Vence hoje!';
  }
  if (dias === 1) {
    return 'Vence amanhã';
  }
  return `Vence em ${dias} dias`;
}

// ============================================================================
// COMPONENTE: MODAL DE IMPORTAÇÃO (DRAG-AND-DROP)
// ============================================================================
function ModalImportacaoAtos({ onClose, onImportado }) {
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

      const resp = await fetch('/api/ecogestao/atos/importar', {
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
  const avisos = Array.isArray(resultado?.avisos) ? resultado.avisos : [];

  const rodape = resultado ? (
    <>
      <button type="button" onClick={limpar} className="btn-secondary text-xs">
        <FileUp size={14} />
        Importar outra
      </button>
      <button type="button" onClick={onClose} className="btn-primary text-xs !bg-amber-600 hover:!bg-amber-700">
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
        form="form-importar-atos"
        disabled={!arquivo || importando}
        className="btn text-xs bg-amber-600 text-white hover:bg-amber-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
      title="Importar Planilha de Atos Autorizativos"
      subtitle="Envie a planilha de licenças e certificados em .xlsx, .xls ou .csv (até 25 MB)."
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
                  O Farol de Vencimentos foi calculado automaticamente com base na validade de cada documento.
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-omega-800 bg-omega-900/60 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Inseridos</div>
              <div className="text-xl font-black text-white tabular-nums mt-0.5">{fmtNumero(importados)}</div>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Normais</div>
              <div className="text-xl font-black text-emerald-400 tabular-nums mt-0.5">{fmtNumero(resumo.total_normais || 0)}</div>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">A Vencer</div>
              <div className="text-xl font-black text-amber-400 tabular-nums mt-0.5">{fmtNumero(resumo.total_a_vencer || 0)}</div>
            </div>
            <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-400">Vencidos</div>
              <div className="text-xl font-black text-rose-400 tabular-nums mt-0.5">{fmtNumero(resumo.total_vencidos || 0)}</div>
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
        <form id="form-importar-atos" onSubmit={importar} className="space-y-4">
          <div className="flex justify-start">
            <button
              type="button"
              onClick={gerarModeloAtos}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-600/20 text-xs font-black text-amber-300 hover:bg-amber-600/40 transition-colors"
            >
              📥 Baixar Planilha Modelo (.xlsx)
            </button>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={aoSoltar}
            onClick={() => inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-150 ${
              arrastando
                ? 'border-amber-500 bg-amber-500/10 scale-[0.99]'
                : 'border-omega-700 bg-omega-900/40 hover:border-amber-500/60 hover:bg-omega-900/80'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => escolherArquivo(e.target.files?.[0])}
            />

            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 text-amber-400 flex items-center justify-center mb-3 shadow-inner">
              <FileCheck2 size={28} />
            </div>

            <div className="text-sm font-bold text-white text-center">
              {arquivo ? (
                <span className="text-amber-400">{arquivo.name}</span>
              ) : (
                <>Arraste sua planilha aqui ou <span className="text-amber-400 underline">clique para selecionar</span></>
              )}
            </div>

            <div className="text-xs text-omega-400 mt-1 text-center">
              Formatos aceitos: .xlsx, .xls ou .csv (até 25 MB)
            </div>

            {arquivo && (
              <div className="mt-3 flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-omega-300">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                {(arquivo.size / (1024 * 1024)).toFixed(2)} MB selecionado
              </div>
            )}
          </div>

          <div className="rounded-xl border border-omega-800 bg-omega-900/40 p-3.5 text-xs text-omega-400 space-y-1.5">
            <div className="font-bold text-omega-200 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Layers size={13} className="text-amber-400" /> Colunas Reconhecidas Automaticamente
            </div>
            <p className="text-[11px] leading-relaxed">
              O importador reconhece variações de cabeçalhos como:
              <br />
              • <strong className="text-omega-300">Serviço/Fornecedor:</strong> DESCRIÇÃO DO TIPO DE SERVIÇO, EMPRESA, FORNECEDOR
              <br />
              • <strong className="text-omega-300">Licença:</strong> LICENÇA, DOCUMENTO, ALVARÁ, CERTIFICADO
              <br />
              • <strong className="text-omega-300">Validade:</strong> VALIDADE, VENCIMENTO, DATA DE VALIDADE
              <br />
              • <strong className="text-omega-300">Status:</strong> STATUS, SITUAÇÃO (padrão: ATIVO)
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
function ModalRegistroAto({ itemEdicao, onClose, onSalvo }) {
  const isEdicao = Boolean(itemEdicao?.id);

  const [descricaoServico, setDescricaoServico] = useState(() => itemEdicao?.descricao_do_tipo_de_servico || '');
  const [licenca, setLicenca] = useState(() => itemEdicao?.licenca || '');
  const [validade, setValidade] = useState(() => (itemEdicao?.validade ? paraInputData(itemEdicao.validade) : hojeISO()));
  const [status, setStatus] = useState(() => itemEdicao?.status || 'ATIVO');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const salvar = async (e) => {
    e.preventDefault();
    setErro(null);

    if (!descricaoServico.trim()) {
      setErro('Informe a descrição do serviço ou empresa fornecedora.');
      return;
    }
    if (!licenca.trim()) {
      setErro('Informe o tipo ou número da licença/alvará.');
      return;
    }
    if (!validade) {
      setErro('A data de validade é obrigatória.');
      return;
    }

    setSalvando(true);
    try {
      const url = isEdicao
        ? `/api/ecogestao/atos/${itemEdicao.id}`
        : '/api/ecogestao/atos';
      const method = isEdicao ? 'PUT' : 'POST';

      const resp = await fetch(url, {
        method,
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          descricao_do_tipo_de_servico: descricaoServico.trim().toUpperCase(),
          licenca: licenca.trim().toUpperCase(),
          validade,
          status: status.toUpperCase(),
        }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.message || `Erro ao salvar licença (HTTP ${resp.status}).`);
      }

      onSalvo?.();
      onClose();
    } catch (err) {
      setErro(err?.message || 'Falha ao salvar ato autorizativo.');
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
        form="form-registro-ato"
        disabled={salvando}
        className="btn text-xs bg-amber-600 text-white hover:bg-amber-700 shadow-sm disabled:opacity-50"
      >
        {salvando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        {salvando ? 'Salvando...' : isEdicao ? 'Salvar alterações' : 'Cadastrar licença'}
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdicao ? 'Editar Ato Autorizativo' : 'Nova Licença / Autorização'}
      subtitle="Cadastre ou edite alvarás e licenças ambientais com controle de farol."
      size="md"
      footer={rodape}
    >
      <form id="form-registro-ato" onSubmit={salvar} className="space-y-4">
        {erro && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 flex items-start gap-2.5 text-xs text-rose-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-400" />
            <span>{erro}</span>
          </div>
        )}

        <div>
          <label className="label text-xs text-omega-300">Descrição do Serviço / Fornecedor *</label>
          <input
            type="text"
            value={descricaoServico}
            onChange={(e) => setDescricaoServico(e.target.value)}
            placeholder="Ex: POSTO PARAUAPEBAS LTDA, OMEGA SERVICE"
            required
            className="input text-xs bg-omega-950 border-omega-700 text-white placeholder-omega-500"
          />

          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="text-[10px] text-omega-500 self-center mr-1">Sugestões:</span>
            {SERVICOS_SUGERIDOS.slice(0, 4).map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => setDescricaoServico(sug)}
                className="rounded-full bg-omega-800 hover:bg-amber-950 hover:text-amber-300 border border-omega-700/60 px-2 py-0.5 text-[10px] font-medium text-omega-300 transition-colors"
              >
                {sug}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label text-xs text-omega-300">Licença / Alvará / Certificado *</label>
          <input
            type="text"
            value={licenca}
            onChange={(e) => setLicenca(e.target.value)}
            placeholder="Ex: LICENÇA DE OPERAÇÃO - LO Nº 1234/2026"
            required
            className="input text-xs bg-omega-950 border-omega-700 text-white placeholder-omega-500"
          />

          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="text-[10px] text-omega-500 self-center mr-1">Exemplos:</span>
            {TIPOS_LICENCA_SUGERIDOS.slice(0, 3).map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => setLicenca(sug)}
                className="rounded-full bg-omega-800 hover:bg-amber-950 hover:text-amber-300 border border-omega-700/60 px-2 py-0.5 text-[10px] font-medium text-omega-300 transition-colors"
              >
                {sug}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label text-xs text-omega-300">Data de Validade *</label>
            <input
              type="date"
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
              required
              className="input text-xs bg-omega-950 border-omega-700 text-white font-bold"
            />
          </div>

          <div>
            <label className="label text-xs text-omega-300">Status *</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input text-xs bg-omega-950 border-omega-700 text-white font-bold"
            >
              <option value="ATIVO">ATIVO</option>
              <option value="INATIVO">INATIVO</option>
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL: ATOS AUTORIZATIVOS VIEW
// ============================================================================
export default function AtosAutorizativosView() {
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState(null);

  // Filtros
  const [filtroFarol, setFiltroFarol] = useState('TODOS');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [busca, setBusca] = useState('');

  // Dados
  const [registros, setRegistros] = useState([]);
  const [resumo, setResumo] = useState({
    total_licencas: 0,
    total_ativas: 0,
    total_inativas: 0,
    total_vencidas: 0,
    total_a_vencer: 0,
    total_normais: 0,
    taxa_conformidade: 100,
    por_servico: [],
  });

  // Modais
  const [modalImportacao, setModalImportacao] = useState(false);
  const [modalFormulario, setModalFormulario] = useState(false);
  const [itemEdicao, setItemEdicao] = useState(null);

  // Paginação
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  // Seleção em lote
  const [selectedIds, setSelectedIds] = useState([]);
  const [excluindoLote, setExcluindoLote] = useState(false);
  // Carrega lista de atos autorizativos
  const carregarDados = useCallback(async (isRefresh = false) => {
    if (isRefresh) setAtualizando(true);
    else setCarregando(true);
    setErro(null);

    try {
      const params = new URLSearchParams();
      if (filtroFarol !== 'TODOS') params.append('farol', filtroFarol);
      if (filtroStatus !== 'TODOS') params.append('status', filtroStatus);
      params.append('limite', '1000');

      const resp = await fetch(`/api/ecogestao/atos?${params.toString()}`, {
        headers: authHeaders(),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body?.message || `Erro ao carregar licenças (HTTP ${resp.status}).`);
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
  }, [filtroFarol, filtroStatus]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Filtragem client-side de busca
  const registrosFiltrados = useMemo(() => {
    return registros.filter((item) => {
      if (busca.trim()) {
        const termo = busca.toLowerCase().trim();
        const servico = String(item.descricao_do_tipo_de_servico || '').toLowerCase();
        const lic = String(item.licenca || '').toLowerCase();
        const farol = String(item.farol_de_vencimentos || '').toLowerCase();
        return servico.includes(termo) || lic.includes(termo) || farol.includes(termo);
      }
      return true;
    });
  }, [registros, busca]);

  // Paginação
  const totalPaginas = Math.max(1, Math.ceil(registrosFiltrados.length / porPagina));
  const inicioIndex = (pagina - 1) * porPagina;
  const fimIndex = Math.min(inicioIndex + porPagina, registrosFiltrados.length);
  const registrosPaginados = useMemo(() => {
    return registrosFiltrados.slice(inicioIndex, fimIndex);
  }, [registrosFiltrados, inicioIndex, fimIndex]);

  // Seleção em lote
  const todosIdsVisiveis = useMemo(() => registrosPaginados.map((r) => r.id), [registrosPaginados]);
  const todosSelecionados = todosIdsVisiveis.length > 0 && todosIdsVisiveis.every((id) => selectedIds.includes(id));

  function toggleSelecionarTodos() {
    if (todosSelecionados) {
      setSelectedIds((prev) => prev.filter((id) => !todosIdsVisiveis.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...todosIdsVisiveis])]);
    }
  }

  function toggleSelecionarItem(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function excluirLote() {
    if (selectedIds.length === 0) return;
    const confirmado = window.confirm(
      `Tem certeza que deseja excluir ${selectedIds.length} ${selectedIds.length === 1 ? 'registro' : 'registros'} selecionado(s)? Esta ação não pode ser desfeita.`
    );
    if (!confirmado) return;
    setExcluindoLote(true);
    try {
      const resp = await fetch('/api/ecogestao/atos/lote', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!resp.ok) throw new Error('Falha ao excluir registros.');
      setSelectedIds([]);
      await carregarDados(true);
    } catch (e) {
      alert(e.message || 'Erro ao excluir registros.');
    } finally {
      setExcluindoLote(false);
    }
  }
  // Dados para o Gráfico Donut de Farol
  const dadosDonutFarol = useMemo(() => {
    const total = resumo.total_licencas || 0;
    if (total === 0) return [];

    const resultado = [];
    if (resumo.total_normais > 0) {
      resultado.push({
        name: 'Normal',
        valor: resumo.total_normais,
        percentual: ((resumo.total_normais / total) * 100).toFixed(1),
        cor: CORES_FAROL.Normal,
      });
    }
    if (resumo.total_a_vencer > 0) {
      resultado.push({
        name: 'A Vencer',
        valor: resumo.total_a_vencer,
        percentual: ((resumo.total_a_vencer / total) * 100).toFixed(1),
        cor: CORES_FAROL['A Vencer'],
      });
    }
    if (resumo.total_vencidas > 0) {
      resultado.push({
        name: 'Vencido',
        valor: resumo.total_vencidas,
        percentual: ((resumo.total_vencidas / total) * 100).toFixed(1),
        cor: CORES_FAROL.Vencido,
      });
    }
    return resultado;
  }, [resumo]);

  // Dados para o Gráfico de Barras de Serviços / Prestadores
  const dadosBarrasServicos = useMemo(() => {
    if (!resumo.por_servico || resumo.por_servico.length === 0) return [];
    return resumo.por_servico.slice(0, 6).map((s) => ({
      servico: s.servico.length > 18 ? `${s.servico.slice(0, 18)}...` : s.servico,
      servicoCompleto: s.servico,
      total: s.total,
      normais: s.normais,
      vencidos: s.vencidos + s.a_vencer,
    }));
  }, [resumo.por_servico]);

  // Exclusão de registro
  const excluirRegistro = async (id) => {
    if (!window.confirm('Tem certeza que deseja excluir este ato autorizativo?')) return;

    try {
      const resp = await fetch(`/api/ecogestao/atos/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error(json?.message || 'Falha ao excluir licença.');
      }
      carregarDados(true);
    } catch (e) {
      alert(e.message);
    }
  };

  const aoImportar = () => {
    carregarDados(true);
  };

  return (
    <div className="space-y-6">
      {/* ==================================================================== */}
      {/* 1. CABEÇALHO DA SUB-PÁGINA COM FILTROS DO FAROL E BOTÕES             */}
      {/* ==================================================================== */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-widest">
            <FileCheck2 size={15} className="text-amber-400" />
            EcoGestão • Conformidade & Licenças
          </div>
          <h1 className="mt-1 text-2xl font-black text-white tracking-tight sm:text-3xl flex items-center gap-2.5">
            Atos Autorizativos & Licenças
            <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-xs font-bold text-amber-400">
              Compliance
            </span>
          </h1>
          <p className="mt-1 text-xs text-omega-300 sm:text-sm max-w-2xl">
            Gestão e controle de vencimentos de alvarás, licenças ambientais, certificados e condicionantes.
          </p>
        </div>

        {/* Controles do Cabeçalho */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Filtro Rápido por Status do Farol */}
          <div className="flex items-center rounded-xl bg-omega-900 border border-omega-800 p-1 text-xs">
            {[
              { id: 'TODOS', rotulo: 'Todos' },
              { id: 'Vencido', rotulo: '🔴 Vencido' },
              { id: 'A Vencer', rotulo: '🟡 A Vencer' },
              { id: 'Normal', rotulo: '🟢 Normal' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltroFarol(f.id)}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
                  filtroFarol === f.id
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-omega-400 hover:text-white'
                }`}
              >
                {f.rotulo}
              </button>
            ))}
          </div>

          {/* Botão Atualizar */}
          <button
            type="button"
            onClick={() => carregarDados(true)}
            disabled={carregando || atualizando}
            className="btn-secondary !bg-omega-900 !border-omega-700 !text-omega-200 hover:!bg-omega-800 text-xs px-3 py-2"
            title="Atualizar dados"
          >
            <RefreshCw size={14} className={atualizando ? 'animate-spin text-amber-400' : ''} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>

          {/* Botão + Nova Licença */}
          <button
            type="button"
            onClick={() => { setItemEdicao(null); setModalFormulario(true); }}
            className="btn-secondary !bg-omega-800 !border-omega-700 !text-white hover:!bg-omega-700 text-xs px-3.5 py-2 flex items-center gap-1.5"
          >
            <Plus size={14} className="text-amber-400" />
            <span>+ Nova Licença</span>
          </button>

          {/* Botão + Importar Planilha */}
          <button
            type="button"
            onClick={() => setModalImportacao(true)}
            className="btn text-xs font-bold bg-amber-600 text-white hover:bg-amber-500 shadow-md shadow-amber-950/40 px-3.5 py-2 flex items-center gap-1.5 transition-all duration-150"
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
        {/* Card 1: Total de Licenças */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-amber-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-yellow-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <FileCheck2 size={20} />
            </span>
            <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[10px] font-black text-amber-300 uppercase tracking-wider">
              Inventário
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Total de Licenças
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-white sm:text-3xl tabular-nums tracking-tight">
              {fmtNumero(resumo.total_licencas)}
            </span>
            <span className="text-xs font-bold text-amber-400">atos</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400">
            {resumo.total_ativas} ativas • {resumo.total_inativas} inativas
          </div>
        </div>

        {/* Card 2: Taxa de Conformidade */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-emerald-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <ShieldCheck size={20} />
            </span>
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-black text-emerald-300 uppercase tracking-wider">
              Conformidade
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Taxa de Regularidade
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-emerald-400 sm:text-3xl tabular-nums tracking-tight">
              {resumo.taxa_conformidade}%
            </span>
            <span className="text-xs font-bold text-emerald-500">regular</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400">
            {resumo.total_normais} licença(s) dentro do prazo
          </div>
        </div>

        {/* Card 3: Licenças Vencidas 🔴 */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-rose-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 to-red-500" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400">
              <AlertTriangle size={20} />
            </span>
            <span className="rounded-full bg-rose-500/10 border border-rose-500/20 px-2.5 py-0.5 text-[10px] font-black text-rose-300 uppercase tracking-wider animate-pulse">
              Vencidas
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            Licenças Vencidas 🔴
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-rose-400 sm:text-3xl tabular-nums tracking-tight">
              {fmtNumero(resumo.total_vencidas)}
            </span>
            <span className="text-xs font-bold text-rose-500">crítico</span>
          </div>
          <div className="mt-2 text-[11px] text-rose-300/80 font-medium">
            Exigem regularização ou renovação imediata
          </div>
        </div>

        {/* Card 4: A Vencer em 30 dias 🟡 */}
        <div className="relative overflow-hidden rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card transition-all hover:border-amber-500/40">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-orange-400" />
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <Clock size={20} />
            </span>
            <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[10px] font-black text-amber-300 uppercase tracking-wider">
              A Vencer
            </span>
          </div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-omega-400">
            A Vencer em 30 dias 🟡
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-amber-400 sm:text-3xl tabular-nums tracking-tight">
              {fmtNumero(resumo.total_a_vencer)}
            </span>
            <span className="text-xs font-bold text-amber-500">atenção</span>
          </div>
          <div className="mt-2 text-[11px] text-omega-400">
            Protocolo de renovação necessário
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 3. GRÁFICOS ANALÍTICOS (RECHARTS TEMA DARK)                          */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico 1: Prestadores / Serviços com Licenças (Barras) - Col 2 */}
        <div className="lg:col-span-2 rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card">
          <div className="flex items-center justify-between pb-4 border-b border-omega-800">
            <div>
              <div className="text-sm font-extrabold text-white flex items-center gap-2">
                <BarChart3 size={16} className="text-amber-400" />
                Conformidade por Fornecedor / Prestador
              </div>
              <div className="text-xs text-omega-400 mt-0.5">
                Licenças regulares vs. com pendências (vencidas ou a vencer).
              </div>
            </div>
            <div className="text-xs text-omega-400 font-bold">
              {resumo.por_servico?.length || 0} fornecedor(es)
            </div>
          </div>

          <div className="mt-4 h-64 w-full">
            {dadosBarrasServicos.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-omega-500 text-xs">
                <BarChart3 size={32} className="mb-2 opacity-40 text-omega-600" />
                Nenhum prestador catalogado para exibir.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosBarrasServicos} margin={{ top: 10, right: 10, left: 0, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                  <XAxis
                    dataKey="servico"
                    stroke="#64748B"
                    tick={{ fill: '#94A3B8', fontSize: 10 }}
                    axisLine={{ stroke: '#334155' }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                  />
                  <YAxis
                    stroke="#64748B"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-xl border border-omega-700 bg-omega-950 p-3 shadow-2xl text-xs max-w-xs">
                          <div className="font-bold text-white mb-1.5 border-b border-omega-800 pb-1">
                            {d.servicoCompleto}
                          </div>
                          <div className="flex items-center justify-between gap-4 text-emerald-400 font-medium">
                            <span>Normais:</span>
                            <strong className="font-bold tabular-nums">{d.normais}</strong>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-amber-400 font-medium mt-1">
                            <span>Vencidas / A Vencer:</span>
                            <strong className="font-bold tabular-nums">{d.vencidos}</strong>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-white font-black border-t border-white/5 pt-1 mt-1">
                            <span>Total de Licenças:</span>
                            <strong className="tabular-nums">{d.total}</strong>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="normais" name="Regulares" fill="#10B981" stackId="a" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="vencidos" name="Com Alerta" fill="#EF4444" stackId="a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Gráfico 2: Proporção do Farol de Vencimentos (Donut) - Col 1 */}
        <div className="rounded-2xl border border-omega-800 bg-omega-900 p-5 shadow-card flex flex-col justify-between">
          <div className="pb-4 border-b border-omega-800">
            <div className="text-sm font-extrabold text-white flex items-center gap-2">
              <PieIcon size={16} className="text-amber-400" />
              Farol de Vencimentos
            </div>
            <div className="text-xs text-omega-400 mt-0.5">
              Proporção de conformidade da base total.
            </div>
          </div>

          <div className="relative my-2 h-48 w-full flex items-center justify-center">
            {dadosDonutFarol.length === 0 ? (
              <div className="text-center text-omega-500 text-xs">
                <PieIcon size={32} className="mx-auto mb-2 opacity-40 text-omega-600" />
                Sem licenças catalogadas.
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
                            Total: <strong className="text-white tabular-nums">{item.valor} licenças</strong>
                          </div>
                          <div className="text-amber-400 font-bold">
                            Proporção: {item.percentual}%
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Pie
                    data={dadosDonutFarol}
                    dataKey="valor"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={74}
                    paddingAngle={3}
                  >
                    {dadosDonutFarol.map((entry, index) => (
                      <Cell key={`donut-${index}`} fill={entry.cor} stroke="#0F172A" strokeWidth={2} />
                    ))}
                  </Pie>
                </RechartsPieChart>
              </ResponsiveContainer>
            )}

            {/* Texto central do Donut */}
            {dadosDonutFarol.length > 0 && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-omega-400">Total</span>
                <span className="text-sm font-black text-white tabular-nums">
                  {resumo.total_licencas}
                </span>
              </div>
            )}
          </div>

          {/* Legenda Customizada */}
          <div className="pt-3 border-t border-omega-800 space-y-2">
            {[
              { label: 'Normal (Dentro do prazo)', valor: resumo.total_normais, cor: CORES_FAROL.Normal },
              { label: 'A Vencer (Próximos 30 dias)', valor: resumo.total_a_vencer, cor: CORES_FAROL['A Vencer'] },
              { label: 'Vencido (Expirado)', valor: resumo.total_vencidas, cor: CORES_FAROL.Vencido },
            ].map((f) => {
              const pct = resumo.total_licencas > 0 ? ((f.valor / resumo.total_licencas) * 100).toFixed(0) : 0;
              return (
                <div key={f.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-omega-300">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.cor }} />
                    <span>{f.label}</span>
                  </div>
                  <div className="flex items-center gap-2 font-bold tabular-nums">
                    <span className="text-white">{f.valor}</span>
                    <span className="text-omega-400 text-[11px]">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 4. TABELA DETALHADA COM BUSCA, FILTRO E PAGINAÇÃO                    */}
      {/* ==================================================================== */}
      <div className="rounded-2xl border border-omega-800 bg-omega-900 shadow-card overflow-hidden">
        {/* Barra superior da tabela */}
        <div className="p-4 border-b border-omega-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-omega-900/80">
          <div>
            <div className="text-sm font-black text-white flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-amber-400" />
              Inventário de Licenças e Alvarás
            </div>
            <div className="text-xs text-omega-400 mt-0.5">
              Relação completa de documentos, prestadores e prazos legais de validade.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Input de busca */}
            <div className="relative w-full sm:w-72">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
              <input
                type="text"
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
                placeholder="Buscar prestador, licença ou alvará..."
                className="input !py-1.5 pl-8 pr-7 text-xs bg-omega-950 border-omega-700 text-white placeholder-omega-500 focus:border-amber-500 w-full"
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

            {/* Filtro por Status ATIVO/INATIVO */}
            <div className="relative">
              <Filter size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-omega-400" />
              <select
                value={filtroStatus}
                onChange={(e) => { setFiltroStatus(e.target.value); setPagina(1); }}
                className="input !w-auto !py-1.5 pl-8 text-xs font-bold bg-omega-950 border-omega-700 text-white focus:border-amber-500"
              >
                <option value="TODOS">Todos os Status</option>
                <option value="ATIVO">Apenas Ativos</option>
                <option value="INATIVO">Apenas Inativos</option>
              </select>
            </div>
          </div>
        </div>

        {/* Informações de registros filtrados */}
        <div className="px-4 py-2 bg-omega-950/60 border-b border-omega-800 text-[11px] text-omega-400 flex items-center justify-between">
          <span>
            Exibindo <strong className="text-white font-bold">{registrosFiltrados.length}</strong> de{' '}
            <strong className="text-white font-bold">{registros.length}</strong> licença(s)
            {(busca || filtroFarol !== 'TODOS' || filtroStatus !== 'TODOS') && (
              <span className="ml-2 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[9px] font-bold uppercase">
                filtro ativo
              </span>
            )}
          </span>
          <span className="font-bold text-omega-300">
            Conformidade: <strong className="text-emerald-400">{resumo.taxa_conformidade}%</strong>
          </span>
        </div>

        {/* Barra de ações em lote */}
        {selectedIds.length > 0 && (
          <div className="mx-4 mb-3 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 shadow-lg">
            <div className="flex items-center gap-2.5 text-sm font-bold text-rose-300">
              <CheckSquare size={16} className="text-rose-400" />
              <span>{selectedIds.length} {selectedIds.length === 1 ? 'registro selecionado' : 'registros selecionados'}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-3 py-1.5 rounded-lg border border-omega-700 bg-omega-800 text-xs font-bold text-omega-300 hover:bg-omega-700 transition-colors"
              >
                Limpar seleção
              </button>
              <button
                type="button"
                onClick={excluirLote}
                disabled={excluindoLote}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/40 bg-rose-600/20 text-xs font-black text-rose-300 hover:bg-rose-600/40 transition-colors disabled:opacity-60"
              >
                {excluindoLote ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Excluir Selecionados
              </button>
            </div>
          </div>
        )}

        {/* Tabela Responsiva */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-omega-800 bg-omega-950/40 text-[10px] font-extrabold uppercase tracking-wider text-omega-400">
                <th className="py-3 pl-4 pr-2 w-10">
                  <button type="button" onClick={toggleSelecionarTodos} className="text-omega-400 hover:text-amber-400 transition-colors">
                    {todosSelecionados ? <CheckSquare size={15} className="text-amber-400" /> : <Square size={15} />}
                  </button>
                </th>
                <th className="py-3 px-4">Descrição do Serviço / Fornecedor</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Licença / Alvará</th>
                <th className="py-3 px-4">Validade</th>
                <th className="py-3 px-4">Farol de Vencimentos</th>
                <th className="py-3 px-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-800/60">
              {carregando ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-omega-400">
                    <Loader2 size={24} className="mx-auto mb-2 animate-spin text-amber-400" />
                    Carregando atos autorizativos...
                  </td>
                </tr>
              ) : registrosPaginados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-omega-400">
                    <FileCheck2 size={28} className="mx-auto mb-2 opacity-30 text-omega-600" />
                    Nenhuma licença encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                registrosPaginados.map((item) => {
                  const farol = item.farol_de_vencimentos || 'Normal';
                  const isVencido = farol === 'Vencido';
                  const isAVencer = farol === 'A Vencer';
                  const isNormal = farol === 'Normal';
                  const isSelecionado = selectedIds.includes(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors duration-100 group ${isSelecionado ? 'bg-amber-900/20 border-l-2 border-amber-500' : 'hover:bg-omega-800/40'}`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 pl-4 pr-2 w-10">
                        <button type="button" onClick={() => toggleSelecionarItem(item.id)} className="text-omega-500 hover:text-amber-400 transition-colors">
                          {isSelecionado ? <CheckSquare size={15} className="text-amber-400" /> : <Square size={15} />}
                        </button>
                      </td>
                      {/* Descrição do Serviço / Fornecedor */}
                      <td className="py-3 px-4 font-black text-white">
                        <div className="flex items-center gap-2">
                          <Building2 size={14} className="text-omega-400 shrink-0" />
                          <span>{item.descricao_do_tipo_de_servico}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                            item.status === 'ATIVO'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-omega-800 text-omega-400 border border-omega-700'
                          }`}
                        >
                          {item.status || 'ATIVO'}
                        </span>
                      </td>

                      {/* Licença / Alvará */}
                      <td className="py-3 px-4 font-bold text-omega-200">
                        <div className="flex items-center gap-1.5">
                          <FileText size={13} className="text-amber-400 shrink-0" />
                          <span>{item.licenca}</span>
                        </div>
                      </td>

                      {/* Validade */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-bold text-white tabular-nums">
                          {formatarDataSemTimezone(item.validade)}
                        </div>
                        <div className="text-[10px] text-omega-400">
                          {diasRestantesTexto(item.validade)}
                        </div>
                      </td>

                      {/* Farol de Vencimentos */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider border shadow-sm ${
                            isVencido
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                              : isAVencer
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          }`}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: isVencido ? '#EF4444' : isAVencer ? '#F59E0B' : '#10B981',
                            }}
                          />
                          {farol}
                        </span>
                      </td>

                      {/* Ações */}
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => { setItemEdicao(item); setModalFormulario(true); }}
                            className="p-1 rounded hover:bg-omega-800 text-omega-400 hover:text-amber-300 transition-colors"
                            title="Editar licença"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => excluirRegistro(item.id)}
                            className="p-1 rounded hover:bg-omega-800 text-omega-400 hover:text-rose-400 transition-colors"
                            title="Excluir licença"
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
        <ModalImportacaoAtos
          onClose={() => setModalImportacao(false)}
          onImportado={aoImportar}
        />
      )}

      {/* Modal de Cadastro / Edição Manual */}
      {modalFormulario && (
        <ModalRegistroAto
          itemEdicao={itemEdicao}
          onClose={() => { setModalFormulario(false); setItemEdicao(null); }}
          onSalvo={() => carregarDados(true)}
        />
      )}
    </div>
  );
}
