import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  FileUp,
  Fuel,
  Gauge,
  Info,
  Leaf,
  Link2,
  Loader2,
  MapPin,
  PieChart,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Truck,
  Unlink,
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

const MESES_LONGOS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const TAMANHO_MAXIMO_ARQUIVO = 20 * 1024 * 1024;
const EXTENSOES_ACEITAS = /\.(xlsx|xls|csv)$/i;
const CORES_FALLBACK = ['#38BDF8', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

const CORES_KPI = {
  litros: '#F59E0B',
  co2: '#10B981',
  media: '#38BDF8',
  registros: '#A78BFA',
};

const TAMANHOS_PAGINA = [10, 25, 50, 100];
const TAMANHO_PAGINA_PADRAO = 25;

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function fmtNumero(valor, casas = 0) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';
  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function fmtCompacto(valor) {
  const numero = Number(valor) || 0;
  if (Math.abs(numero) >= 1_000_000) {
    return `${(numero / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  }
  if (Math.abs(numero) >= 1_000) {
    return `${(numero / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  }
  return fmtNumero(numero, 0);
}

function fmtPct(valor) {
  return `${fmtNumero(valor, 1)}%`;
}

function fmtTamanho(bytes) {
  const numero = Number(bytes) || 0;
  if (numero >= 1024 * 1024) return `${fmtNumero(numero / (1024 * 1024), 1)} MB`;
  return `${fmtNumero(numero / 1024, 0)} KB`;
}

function partesMes(mes) {
  const [ano, numeroMes] = String(mes || '').split('-').map(Number);
  if (!ano || !numeroMes || numeroMes < 1 || numeroMes > 12) return null;
  return { ano, mes: numeroMes };
}

function formatarMesLongo(mes) {
  const partes = partesMes(mes);
  if (!partes) return mes || '—';
  return `${MESES_LONGOS[partes.mes - 1]}/${partes.ano}`;
}

function formatarMesCurto(mes) {
  const partes = partesMes(mes);
  if (!partes) return mes || '—';
  return `${MESES_LONGOS[partes.mes - 1].slice(0, 3)}/${String(partes.ano).slice(-2)}`;
}

// O backend grava o horário da planilha em UTC. Lemos a string ISO diretamente
// para exibir data e hora sem deslocamento de fuso no navegador.
function formatarDataHoraTransacao(valor) {
  if (!valor) return { data: '—', hora: '' };
  const texto = String(valor).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(texto);
  if (iso) {
    return {
      data: `${iso[3]}/${iso[2]}/${iso[1]}`,
      hora: iso[4] && iso[5] ? `${iso[4]}:${iso[5]}` : '',
    };
  }
  return { data: formatarDataSemTimezone(valor), hora: '' };
}

function mesAtualISO() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

function variacaoPercentual(atual, anterior) {
  const base = Number(anterior) || 0;
  if (!base) return null;
  return ((Number(atual) || 0) - base) / base * 100;
}

function corCombustivel(tipo, indice = 0) {
  const texto = normalizarTexto(tipo);
  if (texto.includes('diesel')) return '#F59E0B';
  if (texto.includes('gasolina')) return '#EF4444';
  if (texto.includes('etanol') || texto.includes('alcool')) return '#10B981';
  if (texto.includes('arla')) return '#6366F1';
  if (texto.includes('gnv') || texto.includes('gas natural')) return '#38BDF8';
  if (texto.includes('eletr') || texto.includes('hibrid')) return '#22D3EE';
  return CORES_FALLBACK[indice % CORES_FALLBACK.length];
}

function KpiCard({
  titulo,
  valor,
  unidade,
  descricao,
  Icone,
  cor,
  variacao,
  inverso,
}) {
  const temVariacao = variacao !== null && variacao !== undefined && Number.isFinite(Number(variacao));
  const variacaoNumero = temVariacao ? Number(variacao) : 0;
  const praticamenteZero = temVariacao && Math.abs(variacaoNumero) < 0.05;
  const neutro = inverso === undefined || praticamenteZero;
  const favoravel = !neutro && (inverso ? variacaoNumero < 0 : variacaoNumero > 0);
  const classeVariacao = neutro
    ? 'bg-white/5 text-omega-300'
    : favoravel
      ? 'bg-emerald-500/15 text-emerald-300'
      : 'bg-rose-500/15 text-rose-300';
  const IconeVariacao = variacaoNumero >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-omega-800 bg-omega-900 p-4 shadow-card sm:p-5">
      <div
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${cor}, transparent)` }}
      />
      <div className="flex items-start justify-between gap-2">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${cor}1F`, color: cor }}
        >
          <Icone size={19} />
        </span>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-omega-300">
          {unidade}
        </span>
      </div>
      <div className="mt-4 text-[10px] font-extrabold uppercase tracking-[0.14em] text-omega-400">
        {titulo}
      </div>
      <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-2xl font-black tracking-tight text-white tabular-nums sm:text-3xl">
          {valor}
        </span>
        <span className="shrink-0 text-xs font-bold text-omega-400">{unidade}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-medium leading-snug text-omega-400">{descricao}</span>
        {temVariacao && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums ${classeVariacao}`}
            title="Variação em relação ao mês anterior"
          >
            <IconeVariacao size={11} />
            {fmtPct(Math.abs(variacaoNumero))}
          </span>
        )}
      </div>
      {temVariacao && (
        <div className="mt-0.5 text-[10px] font-medium text-omega-500">vs. mês anterior</div>
      )}
    </div>
  );
}

function ResumoImportacao({ rotulo, valor, Icone, cor }) {
  return (
    <div className="rounded-xl border border-omega-100 bg-omega-50/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-omega-400">{rotulo}</span>
        <Icone size={13} className={`shrink-0 ${cor}`} />
      </div>
      <div className={`mt-0.5 text-lg font-black tabular-nums ${cor}`}>{valor}</div>
    </div>
  );
}

function TooltipRosca({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="rounded-xl border border-omega-700 bg-omega-800 px-3 py-2 shadow-2xl">
      <div className="flex items-center gap-2 text-xs font-bold text-white">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.cor }} />
        {item.nome}
      </div>
      <div className="mt-1 text-[11px] text-omega-300">
        <strong className="text-sm tabular-nums text-white">{fmtNumero(item.litros, 1)} L</strong>
        {' • '}
        {fmtPct(item.percentual)}
      </div>
      <div className="mt-0.5 text-[10px] text-omega-400">
        {fmtNumero(item.co2, 1)} kg CO₂ • {fmtNumero(item.registros)} abastecimento(s)
      </div>
    </div>
  );
}

function TooltipEvolucao({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="rounded-xl border border-omega-700 bg-omega-800 px-3 py-2 shadow-2xl">
      <div className="text-xs font-bold text-white">{formatarMesLongo(item.mes)}</div>
      <div className="mt-1 space-y-0.5 text-[11px] text-omega-300">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-sky-400" />
          <strong className="tabular-nums text-white">{fmtNumero(item.litros, 1)} L</strong>
          <span>de litros</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-400" />
          <strong className="tabular-nums text-white">{fmtNumero(item.co2, 1)} kg</strong>
          <span>de CO₂</span>
        </div>
        <div className="pt-0.5 text-[10px] text-omega-400">
          {fmtNumero(item.registros)} abastecimento(s)
        </div>
      </div>
    </div>
  );
}

function ModalImportacao({ onClose, onImportado }) {
  const [arquivo, setArquivo] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState(null);
  const [resultado, setResultado] = useState(null);
  const inputRef = useRef(null);

  const fechar = () => {
    if (!importando) onClose();
  };

  const escolherArquivo = (file) => {
    if (!file) return;
    if (!EXTENSOES_ACEITAS.test(file.name)) {
      setErro('Formato inválido. Envie uma planilha .xlsx, .xls ou .csv.');
      setArquivo(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (file.size > TAMANHO_MAXIMO_ARQUIVO) {
      setErro('O arquivo excede o limite de 20 MB.');
      setArquivo(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setErro(null);
    setResultado(null);
    setArquivo(file);
  };

  const aoSoltar = (event) => {
    event.preventDefault();
    setArrastando(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) escolherArquivo(file);
  };

  const limpar = () => {
    setArquivo(null);
    setResultado(null);
    setErro(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const importar = async (event) => {
    event?.preventDefault();
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

      const resp = await fetch('/api/abastecimentos/importar', {
        method: 'POST',
        headers,
        body: form,
      });
      const corpo = await resp.json().catch(() => ({}));
      const mensagem = corpo?.mensagem || corpo?.message || corpo?.error;

      if (!resp.ok) {
        // A API devolve resumo e erros detalhados quando a planilha é lida,
        // mas nenhuma linha válida é importada. Nesse caso mostramos o relatório.
        if (corpo?.resumo) {
          setResultado({
            ...corpo,
            mensagem: mensagem || 'Nenhum lançamento foi importado.',
            falha: true,
          });
          return;
        }
        throw new Error(mensagem || `Falha ao importar a planilha (HTTP ${resp.status}).`);
      }

      setResultado(corpo);
      onImportado?.(corpo);
    } catch (e) {
      setErro(e?.message || 'Não foi possível importar a planilha.');
    } finally {
      setImportando(false);
    }
  };

  const resumo = resultado?.resumo || {};
  const erros = Array.isArray(resultado?.erros) ? resultado.erros : [];
  const placasSemVeiculo = Array.isArray(resumo.placas_sem_veiculo) ? resumo.placas_sem_veiculo : [];
  const importadosResumo = Number(resumo.importados) || 0;
  const ignoradosResumo = Number(resumo.ignorados) || 0;
  const duplicadosResumo = Number(resumo.duplicados) || 0;
  const semVeiculoResumo = Number(resumo.linhas_sem_veiculo) || 0;
  const temAlertas = ignoradosResumo > 0
    || duplicadosResumo > 0
    || semVeiculoResumo > 0
    || placasSemVeiculo.length > 0
    || erros.length > 0;

  const rodape = resultado ? (
    <>
      <button type="button" onClick={limpar} className="btn-secondary">
        <FileUp size={15} />
        Importar outra
      </button>
      <button type="button" onClick={fechar} className="btn-primary">
        Concluir
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        onClick={fechar}
        disabled={importando}
        className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        type="submit"
        form="form-importar-abastecimentos"
        disabled={!arquivo || importando}
        className="btn bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {importando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        {importando ? 'Importando...' : 'Importar planilha'}
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={fechar}
      title="Importar Planilha de Abastecimentos"
      subtitle="Envie o relatório da matriz em .xlsx, .xls ou .csv (até 20 MB)."
      size="lg"
      footer={rodape}
    >
      {resultado ? (
        <div className="space-y-4">
          <div
            className={`rounded-xl border px-4 py-3 ${
              importadosResumo > 0
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
            }`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2">
              {importadosResumo > 0 ? (
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0">
                <div className={`text-sm font-bold ${importadosResumo > 0 ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {resultado.mensagem || 'Processamento concluído.'}
                </div>
                <div className={`mt-0.5 text-xs ${importadosResumo > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {fmtNumero(resumo.linhas_lidas)} linha(s) lida(s) na planilha.
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <ResumoImportacao
              rotulo="Registros importados"
              valor={fmtNumero(importadosResumo)}
              Icone={ClipboardList}
              cor="text-emerald-700"
            />
            <ResumoImportacao
              rotulo="Litros somados"
              valor={`${fmtNumero(resumo.total_litros, 1)} L`}
              Icone={Fuel}
              cor="text-amber-700"
            />
            <ResumoImportacao
              rotulo="CO₂ gerado"
              valor={`${fmtNumero(resumo.total_co2_kg, 1)} kg`}
              Icone={Leaf}
              cor="text-emerald-700"
            />
            <ResumoImportacao
              rotulo="Linhas ignoradas"
              valor={fmtNumero(ignoradosResumo)}
              Icone={AlertTriangle}
              cor="text-red-700"
            />
            <ResumoImportacao
              rotulo="Duplicados"
              valor={fmtNumero(duplicadosResumo)}
              Icone={FileSpreadsheet}
              cor="text-amber-700"
            />
            <ResumoImportacao
              rotulo="Linhas sem veículo"
              valor={fmtNumero(semVeiculoResumo)}
              Icone={Truck}
              cor="text-amber-700"
            />
          </div>

          {placasSemVeiculo.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle size={14} />
                Placas não cadastradas na frota
              </div>
              <div className="mt-1 break-words font-mono text-[11px]">{placasSemVeiculo.join(', ')}</div>
              <div className="mt-1 text-[11px] text-amber-700">
                Os lançamentos foram importados como avulsos e poderão ser vinculados depois pela placa.
              </div>
            </div>
          )}

          {erros.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-red-800">
                <AlertTriangle size={14} />
                Linhas ignoradas ({erros.length})
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-auto pr-1">
                {erros.map((item, indice) => (
                  <div key={`${item.linha}-${indice}`} className="flex gap-2 text-[11px] text-red-700">
                    <span className="shrink-0 font-mono font-bold">Linha {item.linha}:</span>
                    <span>{item.motivo}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!temAlertas && (
            <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 size={13} className="shrink-0" />
              Nenhuma linha ignorada e todas as placas foram vinculadas à frota.
            </div>
          )}
        </div>
      ) : (
        <form id="form-importar-abastecimentos" onSubmit={importar} className="space-y-4">
          {erro && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert">
              {erro}
            </div>
          )}

          <div
            onDragOver={(event) => {
              event.preventDefault();
              if (!importando) setArrastando(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setArrastando(false);
            }}
            onDrop={(event) => {
              if (!importando) aoSoltar(event);
            }}
            aria-busy={importando}
            className={`relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
              importando
                ? 'border-emerald-300 bg-emerald-50/60'
                : arrastando
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-omega-200 bg-omega-50/60'
            }`}
          >
            <input
              ref={inputRef}
              id="arquivo-abastecimento"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              disabled={importando}
              onChange={(event) => escolherArquivo(event.target.files?.[0] || null)}
            />
            {arquivo && !importando && (
              <button
                type="button"
                onClick={limpar}
                className="absolute right-2 top-2 rounded-lg p-1.5 text-omega-400 transition-colors hover:bg-omega-100 hover:text-red-600"
                aria-label="Remover arquivo selecionado"
              >
                <X size={14} />
              </button>
            )}
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                importando
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              {importando ? <Loader2 size={24} className="animate-spin" /> : <FileSpreadsheet size={24} />}
            </span>
            <div
              className="max-w-full truncate text-sm font-bold text-omega-900"
              aria-live="polite"
            >
              {importando ? 'Processando planilha...' : arquivo ? arquivo.name : 'Arraste a planilha aqui'}
            </div>
            <div className="text-xs text-omega-500">
              {importando
                ? 'Validando linhas, calculando CO₂ e gravando os lançamentos.'
                : arquivo
                  ? `${fmtTamanho(arquivo.size)} • pronto para importar`
                  : 'ou clique para selecionar um arquivo'}
            </div>
            {!importando && (
              <label
                htmlFor="arquivo-abastecimento"
                className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-omega-200 bg-white px-3 py-1.5 text-xs font-bold text-omega-700 transition-colors hover:bg-omega-50"
              >
                <Upload size={13} />
                {arquivo ? 'Trocar arquivo' : 'Selecionar arquivo'}
              </label>
            )}
            {importando && (
              <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-emerald-100">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500" />
              </div>
            )}
            <div className="mt-1 text-[10px] font-medium text-omega-400">
              Formatos aceitos: .xlsx, .xls e .csv • até 20 MB
            </div>
          </div>

          <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-sky-700">
            <div className="flex items-center gap-1.5 font-bold">
              <Info size={13} />
              Colunas esperadas
            </div>
            <p className="mt-1">
              PLACA, DATA TRANSACAO, TIPO COMBUSTIVEL e LITROS são obrigatórias. Colunas adicionais
              como hodômetro, km rodados, motorista e código da transação são aproveitadas
              automaticamente.
            </p>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EstadoCarregando() {
  return (
    <div className="card flex min-h-[420px] flex-col items-center justify-center gap-3 p-8">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <Loader2 size={26} className="animate-spin" />
      </span>
      <div className="text-sm font-bold text-omega-900">Carregando painel de combustível...</div>
      <div className="text-xs text-omega-400">Consultando abastecimentos, litros e emissões.</div>
    </div>
  );
}

function EstadoErro({ mensagem, onTentarNovamente }) {
  return (
    <div className="card flex min-h-[380px] flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle size={26} />
      </span>
      <div className="text-sm font-bold text-omega-900">Não foi possível carregar o painel.</div>
      <div className="max-w-md text-xs leading-relaxed text-omega-500">{mensagem}</div>
      <button type="button" onClick={onTentarNovamente} className="btn-secondary mt-1">
        <RefreshCw size={14} />
        Tentar novamente
      </button>
    </div>
  );
}

function EstadoSemDados({ onImportar }) {
  return (
    <div className="card flex min-h-[420px] flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <Fuel size={30} />
      </span>
      <div className="text-lg font-extrabold text-omega-900">Nenhum abastecimento importado</div>
      <p className="max-w-md text-sm leading-relaxed text-omega-500">
        Importe a planilha da matriz para acompanhar litros, eficiência e emissões de CO₂ da frota.
        O sistema cruza a placa com a frota e calcula a pegada de carbono automaticamente.
      </p>
      <button
        type="button"
        onClick={onImportar}
        className="btn mt-1 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus:ring-emerald-300"
      >
        <Plus size={15} />
        Importar Planilha
      </button>
    </div>
  );
}

export default function ControleCombustivelView() {
  const [meses, setMeses] = useState([]);
  const [mesSelecionado, setMesSelecionado] = useState('');
  const [dados, setDados] = useState(null);
  const [carregandoMeses, setCarregandoMeses] = useState(true);
  const [carregandoDados, setCarregandoDados] = useState(false);
  const [erro, setErro] = useState(null);
  const [modalImportacao, setModalImportacao] = useState(false);
  const [toast, setToast] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtroCombustivel, setFiltroCombustivel] = useState('TODOS');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(TAMANHO_PAGINA_PADRAO);
  const [gatilho, setGatilho] = useState(0);
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  const mesCarregadoRef = useRef('');

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const carregarMeses = useCallback(async () => {
    const resp = await fetch(`/api/abastecimentos/meses?_t=${Date.now()}`, {
      headers: authHeaders(lerSessao()),
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(corpo?.message || `Falha ao carregar os meses disponíveis (HTTP ${resp.status}).`);
    }
    return {
      meses: Array.isArray(corpo?.meses) ? corpo.meses : [],
      detalhes: Array.isArray(corpo?.detalhes) ? corpo.detalhes : [],
    };
  }, []);

  const carregarDados = useCallback(async (mes) => {
    const resp = await fetch(
      `/api/abastecimentos?mes=${encodeURIComponent(mes)}&limite=2000&_t=${Date.now()}`,
      { headers: authHeaders(lerSessao()) },
    );
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(corpo?.message || `Falha ao carregar os abastecimentos (HTTP ${resp.status}).`);
    }
    return corpo;
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregandoMeses(true);
      setErro(null);
      try {
        const corpo = await carregarMeses();
        if (!vivo) return;
        setMeses(corpo.detalhes);
        const atual = mesAtualISO();
        const escolhido = corpo.detalhes.some((item) => item.mes === atual)
          ? atual
          : (corpo.detalhes[0]?.mes || '');
        setMesSelecionado(escolhido);
      } catch (e) {
        if (vivo) setErro(e?.message || 'Não foi possível carregar os meses disponíveis.');
      } finally {
        if (vivo) setCarregandoMeses(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [carregarMeses]);

  useEffect(() => {
    if (!mesSelecionado) return undefined;

    let vivo = true;
    if (mesCarregadoRef.current !== mesSelecionado) {
      mesCarregadoRef.current = mesSelecionado;
      setDados(null);
    }
    setCarregandoDados(true);
    setErro(null);

    (async () => {
      try {
        const corpo = await carregarDados(mesSelecionado);
        if (!vivo) return;
        setDados(corpo);
        setAtualizadoEm(new Date());
      } catch (e) {
        if (vivo) setErro(e?.message || 'Não foi possível carregar os abastecimentos do mês.');
      } finally {
        if (vivo) setCarregandoDados(false);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [mesSelecionado, gatilho, carregarDados]);

  useEffect(() => {
    setBusca('');
    setFiltroCombustivel('TODOS');
    setPagina(1);
  }, [mesSelecionado]);

  useEffect(() => {
    setPagina(1);
  }, [busca, filtroCombustivel, porPagina]);

  const atualizar = useCallback(async () => {
    setCarregandoMeses(true);
    setErro(null);
    try {
      const corpo = await carregarMeses();
      setMeses(corpo.detalhes);
      const atual = mesAtualISO();
      const escolhido = mesSelecionado && corpo.detalhes.some((item) => item.mes === mesSelecionado)
        ? mesSelecionado
        : (corpo.detalhes.some((item) => item.mes === atual)
          ? atual
          : (corpo.detalhes[0]?.mes || ''));

      if (!escolhido) {
        setMesSelecionado('');
        setDados(null);
        setAtualizadoEm(null);
      } else if (escolhido === mesSelecionado) {
        setGatilho((valor) => valor + 1);
      } else {
        setMesSelecionado(escolhido);
      }
    } catch (e) {
      setErro(e?.message || 'Não foi possível atualizar o painel.');
    } finally {
      setCarregandoMeses(false);
    }
  }, [carregarMeses, mesSelecionado]);

  const aoImportar = useCallback((resultado) => {
    const resumoImportado = resultado?.resumo || {};
    const importados = Number(resumoImportado.importados) || 0;
    const litrosImportados = Number(resumoImportado.total_litros) || 0;
    const co2Importado = Number(resumoImportado.total_co2_kg) || 0;
    const mesesImportados = Array.isArray(resumoImportado.meses) ? resumoImportado.meses : [];
    const mesImportado = mesesImportados[mesesImportados.length - 1] || '';

    setToast({
      tipo: importados > 0 ? 'sucesso' : 'atencao',
      mensagem: importados > 0
        ? `${importados} abastecimento(s) importado(s): ${fmtNumero(litrosImportados, 1)} L e ${fmtNumero(co2Importado, 1)} kg de CO₂.`
        : 'Planilha processada, mas nenhum novo lançamento foi importado.',
    });

    if (mesImportado) {
      setMeses((anteriores) => {
        if (anteriores.some((item) => item.mes === mesImportado)) return anteriores;
        return [
          ...anteriores,
          {
            mes: mesImportado,
            registros: importados,
            total_litros: litrosImportados,
            total_co2_kg: co2Importado,
          },
        ].sort((a, b) => b.mes.localeCompare(a.mes));
      });
    }

    if (mesImportado && mesImportado !== mesSelecionado) {
      setCarregandoDados(true);
      setMesSelecionado(mesImportado);
    } else {
      setGatilho((valor) => valor + 1);
    }

    carregarMeses()
      .then((corpo) => setMeses(corpo.detalhes))
      .catch(() => {
        /* mantém a lista otimista até a próxima atualização */
      });
  }, [carregarMeses, mesSelecionado]);

  const resumo = dados?.resumo || {};
  const registros = useMemo(() => (Array.isArray(dados?.dados) ? dados.dados : []), [dados]);

  const totalLitros = Number(resumo.total_litros) || 0;
  const totalCo2 = Number(resumo.total_co2_kg) || 0;
  const totalRegistros = Number(resumo.total_registros) || 0;
  const mediaNumero = resumo.media_km_por_litro === null || resumo.media_km_por_litro === undefined
    ? Number.NaN
    : Number(resumo.media_km_por_litro);
  const mediaKmPorLitro = Number.isFinite(mediaNumero) ? mediaNumero : null;

  const indiceMes = meses.findIndex((item) => item.mes === mesSelecionado);
  const mesAnterior = indiceMes >= 0 ? meses[indiceMes + 1] : null;
  const variacaoLitros = mesAnterior ? variacaoPercentual(totalLitros, mesAnterior.total_litros) : null;
  const variacaoCo2 = mesAnterior ? variacaoPercentual(totalCo2, mesAnterior.total_co2_kg) : null;
  const variacaoRegistros = mesAnterior ? variacaoPercentual(totalRegistros, mesAnterior.registros) : null;

  const co2Valor = totalCo2 >= 1000 ? fmtNumero(totalCo2 / 1000, 2) : fmtNumero(totalCo2, 1);
  const co2Unidade = totalCo2 >= 1000 ? 't CO₂' : 'kg CO₂';

  const dadosRosca = useMemo(() => {
    const itens = Array.isArray(resumo.por_combustivel) ? resumo.por_combustivel : [];
    const total = itens.reduce((soma, item) => soma + (Number(item.litros) || 0), 0);
    return itens
      .map((item, indice) => {
        const litros = Number(item.litros) || 0;
        return {
          nome: item.tipo_combustivel || 'Não informado',
          litros,
          co2: Number(item.co2_kg) || 0,
          registros: Number(item.registros) || 0,
          percentual: total > 0 ? (litros / total) * 100 : 0,
          cor: corCombustivel(item.tipo_combustivel, indice),
        };
      })
      .filter((item) => item.litros > 0)
      .sort((a, b) => b.litros - a.litros);
  }, [resumo.por_combustivel]);

  const totalRosca = dadosRosca.reduce((soma, item) => soma + item.litros, 0);

  const dadosEvolucao = useMemo(() => {
    const detalhes = Array.isArray(meses) ? meses.slice(0, 12).reverse() : [];
    return detalhes.map((item) => ({
      mes: item.mes,
      label: formatarMesCurto(item.mes),
      litros: Number(item.total_litros) || 0,
      co2: Number(item.total_co2_kg) || 0,
      registros: Number(item.registros) || 0,
      selecionado: item.mes === mesSelecionado,
    }));
  }, [meses, mesSelecionado]);

  const tiposCombustivel = useMemo(() => {
    const tipos = new Set();
    registros.forEach((item) => {
      if (item.tipo_combustivel) tipos.add(item.tipo_combustivel);
    });
    return [...tipos].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [registros]);

  const registrosFiltrados = useMemo(() => {
    const termo = normalizarTexto(busca);
    return registros.filter((item) => {
      if (filtroCombustivel !== 'TODOS' && item.tipo_combustivel !== filtroCombustivel) return false;
      if (!termo) return true;
      return [
        item.tag,
        item.placa,
        item.modelo_veiculo,
        item.nome_motorista,
        item.estabelecimento,
        item.tipo_combustivel,
        item.codigo_transacao,
      ].some((valor) => normalizarTexto(valor).includes(termo));
    });
  }, [busca, filtroCombustivel, registros]);

  const filtrosAtivos = busca.trim() !== '' || filtroCombustivel !== 'TODOS';
  const limparFiltros = () => {
    setBusca('');
    setFiltroCombustivel('TODOS');
    setPagina(1);
  };

  const totalPaginas = Math.max(1, Math.ceil(registrosFiltrados.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicioPagina = (paginaAtual - 1) * porPagina;
  const fimPagina = Math.min(inicioPagina + porPagina, registrosFiltrados.length);
  const registrosPagina = registrosFiltrados.slice(inicioPagina, inicioPagina + porPagina);
  const classeBotaoPagina = 'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-omega-200 bg-white text-omega-500 transition-colors hover:bg-omega-50 hover:text-omega-900 disabled:cursor-not-allowed disabled:opacity-40';

  const totaisFiltrados = useMemo(() => registrosFiltrados.reduce(
    (acumulado, item) => ({
      litros: acumulado.litros + (Number(item.litros) || 0),
      co2: acumulado.co2 + (Number(item.emissao_co2_kg) || 0),
    }),
    { litros: 0, co2: 0 },
  ), [registrosFiltrados]);

  const horarioAtualizacao = atualizadoEm
    ? atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null;

  const mostrarCarregamento = !dados && (carregandoMeses || carregandoDados);
  const temMaisRegistros = !!dados?.paginacao?.tem_mais;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-600">
            <Leaf size={13} />
            Meio Ambiente • ESG
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-omega-900 sm:text-3xl">
            Controle de Combustível &amp; ESG
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-omega-500">
            Monitoramento de consumo de litros, eficiência e pegada de carbono da frota.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {horarioAtualizacao && (
            <span className="hidden text-[11px] font-medium text-omega-400 xl:inline">
              Atualizado às {horarioAtualizacao}
            </span>
          )}

          <div className="relative w-full sm:w-auto">
            <CalendarDays
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-omega-400"
            />
            <select
              value={mesSelecionado}
              onChange={(event) => {
                setCarregandoDados(true);
                setMesSelecionado(event.target.value);
              }}
              disabled={meses.length === 0 || carregandoMeses}
              aria-label="Mês de referência"
              className="input !w-full min-w-[190px] !py-2 pl-9 pr-8 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60 sm:!w-auto"
            >
              {meses.length === 0 && <option value="">Sem meses disponíveis</option>}
              {meses.map((item) => (
                <option key={item.mes} value={item.mes}>
                  {formatarMesLongo(item.mes)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={atualizar}
            disabled={carregandoMeses || carregandoDados}
            className="btn-secondary justify-center disabled:cursor-not-allowed disabled:opacity-50"
            title="Atualizar dados do painel"
          >
            <RefreshCw
              size={15}
              className={carregandoMeses || carregandoDados ? 'animate-spin' : ''}
            />
            {carregandoMeses || carregandoDados ? 'Atualizando...' : 'Atualizar'}
          </button>

          <button
            type="button"
            onClick={() => setModalImportacao(true)}
            className="btn justify-center bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus:ring-emerald-300"
          >
            <Plus size={15} />
            Importar Planilha
          </button>
        </div>
      </div>

      {erro && dados && (
        <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-start gap-2 text-sm text-red-800">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-bold">Falha ao atualizar o painel.</div>
              <div className="mt-0.5 text-xs text-red-700">
                {erro} Os dados exibidos são da última atualização bem-sucedida.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={atualizar}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
          >
            <RefreshCw size={13} />
            Tentar novamente
          </button>
        </div>
      )}

      {mostrarCarregamento ? (
        <EstadoCarregando />
      ) : !dados && erro ? (
        <EstadoErro mensagem={erro} onTentarNovamente={atualizar} />
      ) : !dados ? (
        <EstadoSemDados onImportar={() => setModalImportacao(true)} />
      ) : (
        <div className={'space-y-5 ' + (carregandoDados ? 'pointer-events-none opacity-60 transition-opacity' : '')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              titulo="Total de Litros Consumidos"
              valor={fmtNumero(totalLitros, 1)}
              unidade="L"
              descricao="Volume acumulado no mês selecionado"
              Icone={Fuel}
              cor={CORES_KPI.litros}
              variacao={variacaoLitros}
              inverso
            />
            <KpiCard
              titulo="Emissão Total de CO₂"
              valor={co2Valor}
              unidade={co2Unidade}
              descricao="Pegada de carbono do período"
              Icone={Leaf}
              cor={CORES_KPI.co2}
              variacao={variacaoCo2}
              inverso
            />
            <KpiCard
              titulo="Média Geral de Consumo"
              valor={mediaKmPorLitro === null ? '—' : fmtNumero(mediaKmPorLitro, 2)}
              unidade="km/L"
              descricao={mediaKmPorLitro === null
                ? 'Sem km/L informado nos lançamentos'
                : 'Média consolidada dos abastecimentos'}
              Icone={Gauge}
              cor={CORES_KPI.media}
            />
            <KpiCard
              titulo="Total de Abastecimentos"
              valor={fmtNumero(totalRegistros)}
              unidade="abast."
              descricao="Lançamentos processados no período"
              Icone={ClipboardList}
              cor={CORES_KPI.registros}
              variacao={variacaoRegistros}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <section className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-omega-800 bg-omega-900 p-5 shadow-card xl:col-span-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-extrabold text-white">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
                      <PieChart size={16} />
                    </span>
                    Consumo por Tipo de Combustível
                  </div>
                  <p className="mt-1 text-xs text-omega-400">
                    Distribuição dos litros abastecidos no mês selecionado.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-omega-300">
                  {dadosRosca.length} tipo(s)
                </span>
              </div>

              <div className="mt-3 grid flex-1 items-center gap-3 sm:grid-cols-[1.1fr_1fr]">
                <div
                  className="relative h-[260px] w-full"
                  role="img"
                  aria-label={`Distribuição de litros por combustível: ${
                    dadosRosca.map((item) => `${item.nome} ${fmtPct(item.percentual)}`).join(', ') || 'sem dados'
                  }`}
                >
                  {totalRosca > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={dadosRosca}
                          dataKey="litros"
                          nameKey="nome"
                          cx="50%"
                          cy="50%"
                          innerRadius={64}
                          outerRadius={96}
                          paddingAngle={2}
                          stroke="#0F172A"
                          strokeWidth={3}
                          isAnimationActive={false}
                        >
                          {dadosRosca.map((item) => (
                            <Cell key={item.nome} fill={item.cor} />
                          ))}
                        </Pie>
                        <Tooltip content={<TooltipRosca />} />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <div className="flex h-[190px] w-[190px] flex-col items-center justify-center rounded-full border-[20px] border-omega-800 text-omega-600">
                        <Fuel size={30} />
                        <span className="mt-2 text-[10px] font-bold uppercase tracking-wider text-omega-500">
                          Sem dados
                        </span>
                      </div>
                    </div>
                  )}
                  {totalRosca > 0 && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-omega-500">
                        Total de litros
                      </div>
                      <div className="text-2xl font-black tabular-nums text-white">
                        {fmtNumero(totalRosca, 0)}
                      </div>
                      <div className="text-[10px] font-semibold text-omega-400">L no mês</div>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  {dadosRosca.length > 0 ? (
                    dadosRosca.map((item) => (
                      <div
                        key={item.nome}
                        className="rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: item.cor }}
                          />
                          <span
                            className="min-w-0 flex-1 truncate text-xs font-semibold text-omega-200"
                            title={item.nome}
                          >
                            {item.nome}
                          </span>
                          <span className="text-[11px] font-extrabold tabular-nums text-white">
                            {fmtPct(item.percentual)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between pl-[18px] text-[10px] text-omega-400">
                          <span>{fmtNumero(item.litros, 1)} L</span>
                          <span>{fmtNumero(item.co2, 1)} kg CO₂</span>
                        </div>
                        <div className="ml-[18px] mt-1 h-1 overflow-hidden rounded-full bg-white/5">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, Math.max(0, item.percentual))}%`,
                              backgroundColor: item.cor,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-omega-700 px-3 py-6 text-center text-[11px] text-omega-500">
                      Importe uma planilha para visualizar a distribuição por combustível.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-omega-800 pt-3 text-[11px] text-omega-400">
                <span>
                  Maior consumo:{' '}
                  <strong className="font-bold text-white">{dadosRosca[0]?.nome || '—'}</strong>
                  {dadosRosca[0] && (
                    <>
                      {' '}com{' '}
                      <strong className="font-bold text-white">{fmtPct(dadosRosca[0].percentual)}</strong>
                      {' '}dos litros
                    </>
                  )}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-omega-300">
                  <Leaf size={11} className="text-emerald-400" />
                  {fmtNumero(totalCo2, 1)} kg CO₂
                </span>
              </div>
            </section>

            <section className="relative min-w-0 overflow-hidden rounded-xl border border-omega-800 bg-omega-900 p-5 shadow-card xl:col-span-7">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-extrabold text-white">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
                      <BarChart3 size={16} />
                    </span>
                    Evolução Mensal — Litros &amp; CO₂
                  </div>
                  <p className="mt-1 text-xs text-omega-400">
                    Comparativo dos últimos {dadosEvolucao.length} mês(es) com dados.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-omega-300">
                  Últimos 12 meses
                </span>
              </div>

              <div className="mt-4 h-[280px] w-full">
                {dadosEvolucao.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dadosEvolucao}
                      margin={{ top: 8, right: 0, left: -18, bottom: 0 }}
                      barGap={4}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1E293B" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: '#94A3B8' }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        yAxisId="litros"
                        tick={{ fontSize: 10, fill: '#94A3B8' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={fmtCompacto}
                        width={46}
                      />
                      <YAxis
                        yAxisId="co2"
                        orientation="right"
                        tick={{ fontSize: 10, fill: '#94A3B8' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={fmtCompacto}
                        width={46}
                      />
                      <Tooltip
                        content={<TooltipEvolucao />}
                        cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                      />
                      <Bar
                        yAxisId="litros"
                        dataKey="litros"
                        name="Litros"
                        fill="#38BDF8"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={18}
                        isAnimationActive={false}
                      >
                        {dadosEvolucao.map((item) => (
                          <Cell
                            key={`litros-${item.mes}`}
                            fill="#38BDF8"
                            fillOpacity={item.selecionado ? 1 : 0.4}
                          />
                        ))}
                      </Bar>
                      <Bar
                        yAxisId="co2"
                        dataKey="co2"
                        name="CO₂"
                        fill="#FB7185"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={18}
                        isAnimationActive={false}
                      >
                        {dadosEvolucao.map((item) => (
                          <Cell
                            key={`co2-${item.mes}`}
                            fill="#FB7185"
                            fillOpacity={item.selecionado ? 1 : 0.4}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-omega-800 text-omega-500">
                    <BarChart3 size={28} />
                    <span className="text-xs font-semibold">Sem evolução mensal disponível</span>
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-col gap-1 text-[10px] text-omega-500 sm:flex-row sm:items-center sm:justify-between">
                <span>Barras mais claras indicam meses anteriores.</span>
                <span className="inline-flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-sky-400" />
                    Litros (eixo esquerdo)
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-rose-400" />
                    CO₂ (eixo direito)
                  </span>
                </span>
              </div>
            </section>
          </div>

          <section className="card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-omega-100 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-omega-900">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    <Table2 size={16} />
                  </span>
                  Lançamentos do período
                  <span className="rounded-full bg-omega-100 px-2 py-0.5 text-[10px] font-bold text-omega-500">
                    {fmtNumero(registrosFiltrados.length)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-omega-500">
                  {formatarMesLongo(mesSelecionado)} • {fmtNumero(registros.length)} registro(s) no mês
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="relative w-full sm:w-72">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-omega-400"
                  />
                  <input
                    type="text"
                    inputMode="search"
                    value={busca}
                    onChange={(event) => setBusca(event.target.value)}
                    placeholder="Buscar placa, TAG, motorista ou posto..."
                    className="input w-full !py-1.5 pl-9 pr-8 text-xs"
                    aria-label="Buscar lançamento por placa, TAG, motorista ou estabelecimento"
                  />
                  {busca && (
                    <button
                      type="button"
                      onClick={() => setBusca('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-omega-400 transition-colors hover:bg-omega-100 hover:text-omega-700"
                      aria-label="Limpar busca"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="relative w-full sm:w-auto">
                  <Fuel
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-omega-400"
                  />
                  <select
                    value={filtroCombustivel}
                    onChange={(event) => setFiltroCombustivel(event.target.value)}
                    className="input !w-full !py-1.5 pl-8 text-xs sm:!w-auto sm:min-w-[190px]"
                    aria-label="Filtrar por tipo de combustível"
                  >
                    <option value="TODOS">Todos os combustíveis</option>
                    {tiposCombustivel.map((tipo) => (
                      <option key={tipo} value={tipo}>{tipo}</option>
                    ))}
                  </select>
                </div>
                {filtrosAtivos && (
                  <button
                    type="button"
                    onClick={limparFiltros}
                    className="inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-omega-500 transition-colors hover:bg-omega-100 hover:text-omega-800"
                  >
                    <X size={12} />
                    Limpar filtros
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-omega-100 bg-omega-50/40 px-4 py-2.5 text-[11px] text-omega-500">
              <span className="flex flex-wrap items-center gap-1.5">
                <strong className="font-bold tabular-nums text-omega-800">{fmtNumero(registrosFiltrados.length)}</strong>
                {' '}de{' '}
                <strong className="font-bold tabular-nums text-omega-800">{fmtNumero(registros.length)}</strong>
                {' '}lançamento(s) no mês
                {filtrosAtivos && (
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                    filtro ativo
                  </span>
                )}
              </span>
              <span className="inline-flex flex-wrap items-center gap-3">
                <span>
                  <span className="text-omega-400">Litros:</span>{' '}
                  <strong className="font-bold tabular-nums text-omega-800">{fmtNumero(totaisFiltrados.litros, 1)}</strong>
                  {' '}L
                </span>
                <span>
                  <span className="text-omega-400">CO₂:</span>{' '}
                  <strong className="font-bold tabular-nums text-omega-800">{fmtNumero(totaisFiltrados.co2, 1)}</strong>
                  {' '}kg
                </span>
              </span>
            </div>

            <div className="max-h-[560px] overflow-auto scroll-smooth">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-omega-100 bg-white/95 text-[10px] font-extrabold uppercase tracking-wider text-omega-500 backdrop-blur">
                    <th scope="col" className="px-4 py-2.5">Data / Hora</th>
                    <th scope="col" className="px-4 py-2.5">Placa / TAG</th>
                    <th scope="col" className="px-4 py-2.5">Motorista</th>
                    <th scope="col" className="px-4 py-2.5">Combustível</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Litros</th>
                    <th scope="col" className="px-4 py-2.5 text-right">KM / Horas</th>
                    <th scope="col" className="px-4 py-2.5 text-right">CO₂ (kg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-omega-100">
                  {registrosPagina.map((item) => {
                    const indiceTipo = tiposCombustivel.indexOf(item.tipo_combustivel);
                    const cor = corCombustivel(item.tipo_combustivel, indiceTipo);
                    const dataHora = formatarDataHoraTransacao(item.data_transacao);
                    const tag = String(item.tag || '').trim();
                    const vinculado = tag.length > 0;
                    return (
                      <tr key={item.id} className="transition-colors hover:bg-omega-50/60">
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="text-xs font-bold tabular-nums text-omega-800">{dataHora.data}</div>
                          {dataHora.hora && (
                            <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium tabular-nums text-omega-400">
                              <Clock size={10} />
                              {dataHora.hora}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                vinculado
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : 'bg-amber-50 text-amber-600'
                              }`}
                            >
                              <Truck size={14} />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-extrabold tracking-wide text-omega-900">
                                {item.placa}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {vinculado ? (
                                  <>
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700"
                                      title="Placa vinculada à frota MobDesmob"
                                    >
                                      <Link2 size={9} />
                                      TAG {tag}
                                    </span>
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600">
                                      Frota
                                    </span>
                                  </>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700"
                                    title="Placa avulsa: sem vínculo na frota MobDesmob"
                                  >
                                    <Unlink size={9} />
                                    Avulsa
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="max-w-[190px]">
                            <div
                              className="truncate text-xs font-semibold text-omega-700"
                              title={item.nome_motorista || ''}
                            >
                              {item.nome_motorista || '—'}
                            </div>
                            <div
                              className="mt-0.5 flex items-center gap-1 text-[10px] text-omega-400"
                              title={item.estabelecimento || 'Estabelecimento não informado'}
                            >
                              <MapPin size={10} className="shrink-0" />
                              <span className="truncate">{item.estabelecimento || 'Posto não informado'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex max-w-[150px] items-center gap-1.5 truncate rounded-md border px-2 py-0.5 text-[11px] font-bold"
                            style={{
                              backgroundColor: `${cor}1A`,
                              color: cor,
                              borderColor: `${cor}40`,
                            }}
                            title={item.tipo_combustivel}
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
                            <span className="truncate">{item.tipo_combustivel}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <span className="text-xs font-extrabold tabular-nums text-omega-900">
                            {fmtNumero(item.litros, 1)}
                          </span>
                          <span className="ml-0.5 text-[9px] font-bold text-omega-400">L</span>
                        </td>
                        <td
                          className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold tabular-nums text-omega-600"
                          title="Quilômetros rodados ou horas trabalhadas"
                        >
                          {item.km_rodados_horas === null || item.km_rodados_horas === undefined
                            ? '—'
                            : fmtNumero(item.km_rodados_horas, 0)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {item.emissao_co2_kg === null || item.emissao_co2_kg === undefined ? (
                            <span className="text-xs font-semibold text-omega-400">—</span>
                          ) : (
                            <span className="inline-flex items-center justify-end gap-1 text-xs font-extrabold tabular-nums text-emerald-700">
                              <Leaf size={12} className="shrink-0" />
                              {fmtNumero(item.emissao_co2_kg, 1)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {registrosPagina.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center">
                        <Fuel size={28} className="mx-auto text-omega-300" />
                        <div className="mt-2 text-sm font-bold text-omega-700">
                          {registros.length === 0
                            ? 'Nenhum abastecimento neste mês'
                            : 'Nenhum lançamento encontrado'}
                        </div>
                        <div className="mt-0.5 text-xs text-omega-400">
                          {registros.length === 0
                            ? 'Importe a planilha da matriz para começar o acompanhamento.'
                            : 'Ajuste a busca ou o filtro de combustível.'}
                        </div>
                        {registros.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => setModalImportacao(true)}
                            className="btn-secondary mt-3 !py-1.5 text-xs"
                          >
                            <Plus size={13} />
                            Importar planilha
                          </button>
                        ) : filtrosAtivos ? (
                          <button
                            type="button"
                            onClick={limparFiltros}
                            className="btn-secondary mt-3 !py-1.5 text-xs"
                          >
                            <X size={13} />
                            Limpar filtros
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {temMaisRegistros && (
              <div className="flex items-start gap-1.5 border-t border-amber-200 bg-amber-50/40 px-4 py-2.5 text-[11px] text-amber-700">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>
                  Exibindo os {fmtNumero(dados?.paginacao?.limite || 0)} registros mais recentes do mês.
                  Refine a busca ou o filtro para localizar lançamentos anteriores.
                </span>
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-omega-100 bg-omega-50/40 px-4 py-3 text-[11px] text-omega-500 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span>
                  {registrosFiltrados.length > 0 ? (
                    <>
                      Mostrando{' '}
                      <strong className="font-bold tabular-nums text-omega-800">{fmtNumero(inicioPagina + 1)}</strong>
                      {' '}–{' '}
                      <strong className="font-bold tabular-nums text-omega-800">{fmtNumero(fimPagina)}</strong>
                      {' '}de{' '}
                      <strong className="font-bold tabular-nums text-omega-800">{fmtNumero(registrosFiltrados.length)}</strong>
                      {' '}lançamento(s) filtrado(s)
                    </>
                  ) : (
                    'Nenhum lançamento para exibir'
                  )}
                </span>
                <label className="inline-flex items-center gap-1.5">
                  <span>Por página</span>
                  <select
                    value={porPagina}
                    onChange={(event) => setPorPagina(Number(event.target.value))}
                    className="input !w-auto !py-1 !pl-2 !pr-6 text-[11px]"
                    aria-label="Registros por página"
                  >
                    {TAMANHOS_PAGINA.map((tamanho) => (
                      <option key={tamanho} value={tamanho}>{tamanho}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex items-center justify-between gap-1 sm:justify-end">
                <button
                  type="button"
                  onClick={() => setPagina(1)}
                  disabled={paginaAtual <= 1}
                  className={classeBotaoPagina}
                  aria-label="Primeira página"
                  title="Primeira página"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setPagina(Math.max(1, paginaAtual - 1))}
                  disabled={paginaAtual <= 1}
                  className={classeBotaoPagina}
                  aria-label="Página anterior"
                  title="Página anterior"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="px-2 text-[11px] font-bold tabular-nums text-omega-700">
                  Página {paginaAtual} de {totalPaginas}
                </span>
                <button
                  type="button"
                  onClick={() => setPagina(Math.min(totalPaginas, paginaAtual + 1))}
                  disabled={paginaAtual >= totalPaginas}
                  className={classeBotaoPagina}
                  aria-label="Próxima página"
                  title="Próxima página"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setPagina(totalPaginas)}
                  disabled={paginaAtual >= totalPaginas}
                  className={classeBotaoPagina}
                  aria-label="Última página"
                  title="Última página"
                >
                  <ChevronsRight size={14} />
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {modalImportacao && (
        <ModalImportacao
          onClose={() => setModalImportacao(false)}
          onImportado={aoImportar}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] flex max-w-md items-start gap-2 rounded-xl bg-omega-900 py-2.5 pl-3 pr-4 text-sm font-semibold text-white shadow-2xl">
          {toast.tipo === 'sucesso' ? (
            <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-400" />
          )}
          <span className="leading-snug">{toast.mensagem}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-1 rounded-full p-0.5 hover:bg-white/15"
            aria-label="Fechar notificação"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}




