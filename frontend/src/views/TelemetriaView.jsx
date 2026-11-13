// ============================================================================
// frontend/src/views/TelemetriaView.jsx — Telemetria & Fadiga (PGS-007245 Rev. 03).
//
// KPIs (com variação contra a janela anterior), histórico de eventos com busca,
// severidade e pílulas por tipo, seleção e exclusão em lote, Top 5 de veículos,
// alerta de risco do dia, exportação CSV e importação da planilha da plataforma
// (prévia antes de gravar + planilha modelo). Dados: /api/telemetria.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  FileUp,
  Gauge,
  Loader2,
  MapPin,
  Moon,
  Radio,
  RefreshCw,
  Trash2,
  TrendingDown,
  Truck,
  Upload,
  Search,
  Zap,
} from 'lucide-react';
import StatCard from '../components/StatCard.jsx';
import BadgeStatus from '../components/BadgeStatus.jsx';
import Modal from '../components/Modal.jsx';
import { lerSessao } from '../utils/sessao.js';
import { podeEscrever } from '../utils/permissoes.js';
import { gerarModeloTelemetria } from '../utils/gerarModeloTelemetria.js';

// Pílulas da tela -> eventos gravados (Fadiga inclui a parada obrigatória não cumprida).
const TIPOS = [
  { label: 'Todos', eventos: [] },
  { label: 'Excesso de Velocidade', eventos: ['Excesso de Velocidade'] },
  { label: 'Arrancada Brusca', eventos: ['Arrancada Brusca'] },
  { label: 'Freada de Emergência', eventos: ['Freada de Emergência'] },
  { label: 'Fadiga / Sono', eventos: ['Fadiga / Sono', 'Fadiga sem Parada Obrigatória'] },
  { label: 'Uso de Celular', eventos: ['Uso de Celular'] },
];

const SEVERIDADES = [
  { id: 'NORMAL', label: 'Normal' },
  { id: 'MODERADO', label: 'Moderado' },
  { id: 'GRAVE', label: 'Grave' },
  { id: 'CRITICO', label: 'Crítico' },
];

const PERIODOS = [
  { id: '24', label: 'Últimas 24h', horas: 24 },
  { id: '168', label: 'Últimos 7 dias', horas: 168 },
  { id: '720', label: 'Últimos 30 dias', horas: 720 },
  { id: 'tudo', label: 'Todo o período', horas: null },
];

const POR_PAGINA = 50;
/** Plataforma de rastreamento aberta pelo botão "Abrir Tracker". */
const URL_TRACKER = import.meta.env.VITE_TRACKER_URL || '';

function obterHeaders(json = false) {
  const sessao = lerSessao();
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (sessao?.token) headers.Authorization = `Bearer ${sessao.token}`;
  if (sessao?.usuario?.matricula) headers['x-acting-matricula'] = sessao.usuario.matricula;
  return headers;
}

async function lerJson(resposta, padrao) {
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.message || dados.error || `${padrao} (${resposta.status}).`);
  return dados;
}

function paramsDosFiltros(filtros, extras = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...filtros, ...extras }).forEach(([chave, valor]) => {
    const texto = Array.isArray(valor) ? valor.join(',') : valor;
    if (texto !== '' && texto !== null && texto !== undefined) params.set(chave, String(texto));
  });
  return params.toString();
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Variação contra a janela anterior para o StatCard: menos eventos = melhoria (verde). */
function tendencia(atual, anterior) {
  if (anterior === null || anterior === undefined || anterior === 0) return {};
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  return pct <= 0 ? { trend: Math.abs(pct), trendLabel: 'melhoria' } : { trend: -pct, trendLabel: 'piora' };
}

function celulaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = typeof valor === 'number' ? String(valor).replace('.', ',') : String(valor);
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

const COLUNAS_CSV = [
  ['Data / Hora', (e) => formatarDataHora(e.data_hora)],
  ['TAG', (e) => e.tag],
  ['Placa', (e) => e.tag_placa],
  ['Motorista', (e) => e.motorista],
  ['Evento', (e) => e.evento],
  ['Valor', (e) => e.valor],
  ['Limite', (e) => e.limite],
  ['Excesso (%)', (e) => e.percentual_excesso],
  ['Duração (s)', (e) => e.duracao_s],
  ['Localização', (e) => e.localizacao],
  ['Latitude', (e) => e.latitude],
  ['Longitude', (e) => e.longitude],
  ['Severidade', (e) => e.severidade],
  ['Classificação', (e) => e.classificacao],
  ['Ocorrência no mês', (e) => e.ocorrencia_no_mes],
  ['Medida recomendada (Anexo I)', (e) => e.medida_recomendada],
  ['Status da tratativa', (e) => e.status_tratativa],
  ['Prazo da tratativa', (e) => e.prazo_tratativa?.slice(0, 10)],
  ['Evento original', (e) => e.evento_original],
];

/** CSV com ";" e BOM, para abrir direto no Excel em português. */
function gerarCsv(eventos) {
  const linhas = [
    COLUNAS_CSV.map(([titulo]) => titulo).join(';'),
    ...eventos.map((e) => COLUNAS_CSV.map(([, ler]) => celulaCsv(ler(e))).join(';')),
  ];
  return `﻿${linhas.join('\r\n')}`;
}

function baixar(conteudo, nome) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function valorLimite(e) {
  const temValor = e.valor !== null && e.valor !== undefined;
  if (e.evento === 'Excesso de Velocidade' && temValor && e.limite !== null && e.limite !== undefined) {
    return { valor: Math.round(e.valor), limite: `${Math.round(e.limite)} km/h` };
  }
  return temValor ? { valor: `${Math.round(e.valor)} km/h`, limite: null } : { valor: '—', limite: null };
}

/**
 * Envia a planilha com XMLHttpRequest (o fetch não informa o progresso do upload).
 * `aoProgredir({ etapa: 'enviando' | 'processando', percentual })`.
 */
function enviarPlanilha(arquivo, confirmar, aoProgredir) {
  return new Promise((resolve, reject) => {
    const formulario = new FormData();
    formulario.append('arquivo', arquivo);
    formulario.append('confirmar', confirmar ? 'true' : 'false');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/telemetria/importar');
    Object.entries(obterHeaders(false)).forEach(([nome, valor]) => xhr.setRequestHeader(nome, valor));
    xhr.timeout = 180000;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const percentual = Math.round((e.loaded / e.total) * 100);
      aoProgredir({ etapa: percentual >= 100 ? 'processando' : 'enviando', percentual });
    };
    // Upload concluído: o servidor ainda lê e classifica as linhas.
    xhr.upload.onload = () => aoProgredir({ etapa: 'processando', percentual: 100 });
    xhr.onload = () => {
      let dados = {};
      try {
        dados = JSON.parse(xhr.responseText || '{}');
      } catch {
        /* resposta sem JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(dados);
      else reject(new Error(dados.message || dados.error || `Erro ao processar a planilha (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Falha de conexão ao enviar a planilha.'));
    xhr.ontimeout = () => reject(new Error('O servidor demorou demais para processar a planilha.'));
    aoProgredir({ etapa: 'enviando', percentual: 0 });
    xhr.send(formulario);
  });
}

function BarraProgresso({ progresso, confirmando }) {
  if (!progresso) return null;
  const processando = progresso.etapa === 'processando';
  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-xs font-semibold text-omega-700">
        <span className="flex items-center gap-1.5">
          <Loader2 size={13} className="animate-spin" />
          {processando
            ? (confirmando ? 'Gravando eventos no banco...' : 'Lendo e classificando as linhas...')
            : 'Enviando planilha...'}
        </span>
        <span className="tabular-nums">{processando ? '' : `${progresso.percentual}%`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-omega-100">
        <div
          className={`h-full rounded-full bg-omega-accent transition-all duration-200 ${processando ? 'animate-pulse' : ''}`}
          style={{ width: `${processando ? 100 : Math.max(3, progresso.percentual)}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Modal de importação: prévia (nada é gravado) -> confirmação
// ============================================================================
function ModalImportar({ aberto, onFechar, onImportado }) {
  const inputRef = useRef(null);
  const [arquivo, setArquivo] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [relatorio, setRelatorio] = useState(null);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [arrastando, setArrastando] = useState(false);

  function escolher(file) {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setErro('Formato inválido. Envie .xlsx, .xls ou .csv.');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setErro('Arquivo muito grande. O limite é de 30 MB.');
      return;
    }
    setErro(null);
    setPrevia(null);
    setRelatorio(null);
    setArquivo(file);
  }

  function fechar() {
    if (enviando) return;
    setArquivo(null);
    setPrevia(null);
    setRelatorio(null);
    setErro(null);
    onFechar();
  }

  async function enviar(confirmar) {
    if (!arquivo) return;
    setEnviando(true);
    setConfirmando(confirmar);
    setErro(null);
    try {
      const dados = await enviarPlanilha(arquivo, confirmar, setProgresso);
      if (confirmar) {
        setRelatorio(dados);
        setPrevia(null);
        setArquivo(null);
        onImportado();
      } else {
        setPrevia(dados);
      }
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
      setProgresso(null);
    }
  }

  const resumo = relatorio || previa;

  return (
    <Modal
      open={aberto}
      onClose={fechar}
      title="Importar Planilha de Telemetria"
      subtitle="Use a planilha modelo (DATA/HORA, TAG/PLACA, MOTORISTA, EVENTO, VALOR REGISTRADO, VELOCIDADE LIMITE, LOCALIZAÇÃO, SEVERIDADE) ou a exportação da plataforma de telemetria. Reimportar o mesmo arquivo não duplica eventos."
      size="md"
    >
      <div className="space-y-4">
        {erro && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-status-vermelho">
            <AlertCircle size={16} className="shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <button type="button" onClick={gerarModeloTelemetria} className="btn-secondary text-xs">
          📥 Baixar Planilha Modelo (.xlsx)
        </button>

        <div
          role="button"
          tabIndex={0}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); escolher(e.dataTransfer.files?.[0]); }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
            arrastando ? 'border-omega-accent bg-blue-50' : arquivo ? 'border-status-verde bg-green-50' : 'border-omega-200 hover:border-omega-400 bg-omega-50'
          }`}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
          {arquivo ? (
            <div className="space-y-1">
              <FileSpreadsheet size={36} className="mx-auto text-status-verde" />
              <div className="text-sm font-bold text-omega-900">{arquivo.name}</div>
              <div className="text-xs text-omega-500">{(arquivo.size / (1024 * 1024)).toFixed(2)} MB • Clique para trocar</div>
            </div>
          ) : (
            <div className="space-y-1">
              <FileUp size={36} className="mx-auto text-omega-accent" />
              <div className="text-sm font-bold text-omega-900">Arraste a planilha aqui ou clique para procurar</div>
              <div className="text-xs text-omega-500">.xlsx, .xls ou .csv (até 30 MB). Posições, ignição e cercas são ignoradas.</div>
            </div>
          )}
        </div>

        {resumo && (
          <div className={`space-y-3 rounded-xl border p-4 ${relatorio ? 'border-green-200 bg-green-50' : 'border-omega-200 bg-omega-50'}`}>
            <div className={`flex items-center gap-2 text-xs font-bold ${relatorio ? 'text-status-verde' : 'text-omega-700'}`}>
              {relatorio ? <CheckCircle2 size={16} /> : <FileSpreadsheet size={16} />}
              {relatorio
                ? `Importação concluída: ${relatorio.importados} evento(s) gravado(s), ${relatorio.duplicados_ignorados} já existiam.`
                : 'Prévia — nada foi gravado ainda.'}
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
              {[
                ['Linhas lidas', resumo.linhas_lidas, 'text-omega-900'],
                ['Eventos de conduta', resumo.total_eventos, 'text-omega-accent'],
                ['Fadigas', resumo.fadiga?.total, 'text-status-amarelo'],
                ['Sem parada em 15 min', resumo.fadiga?.sem_parada, 'text-status-vermelho'],
              ].map(([rotulo, valor, cor]) => (
                <div key={rotulo} className="rounded-lg bg-white p-2">
                  <div className={`text-lg font-extrabold tabular-nums ${cor}`}>{Number(valor || 0).toLocaleString('pt-BR')}</div>
                  <div className="text-[10px] text-omega-500">{rotulo}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(resumo.por_severidade || {}).map(([sev, n]) => (
                <span key={sev} className="inline-flex items-center gap-1">
                  <BadgeStatus status={sev} />
                  <span className="text-xs font-bold text-omega-700 tabular-nums">{n}</span>
                </span>
              ))}
            </div>
            <ul className="divide-y divide-omega-100 text-xs text-omega-700">
              {Object.entries(resumo.por_evento || {}).map(([evento, n]) => (
                <li key={evento} className="flex justify-between py-1">
                  <span>{evento}</span>
                  <span className="font-bold tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
            {resumo.placas_sem_veiculo?.length > 0 && (
              <p className="text-[11px] text-status-amarelo">
                Placas sem TAG na frota (ficam só com a placa): {resumo.placas_sem_veiculo.join(', ')}
              </p>
            )}
            {resumo.periodo && (
              <p className="text-[11px] text-omega-500">
                Período: {formatarDataHora(resumo.periodo.inicio)} a {formatarDataHora(resumo.periodo.fim)}
              </p>
            )}
          </div>
        )}

        <BarraProgresso progresso={progresso} confirmando={confirmando} />

        <div className="flex items-center justify-end gap-2 border-t border-omega-100 pt-3">
          <button type="button" onClick={fechar} className="btn-secondary" disabled={enviando}>Fechar</button>
          {previa ? (
            <button type="button" onClick={() => enviar(true)} className="btn-primary" disabled={enviando || !previa.total_eventos}>
              {enviando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Confirmar Importação
            </button>
          ) : (
            <button type="button" onClick={() => enviar(false)} className="btn-primary" disabled={enviando || !arquivo}>
              {enviando && <Loader2 size={14} className="animate-spin" />}
              {enviando ? 'Lendo planilha...' : 'Ver Prévia'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Tela
// ============================================================================
export default function TelemetriaView() {
  const usuario = lerSessao()?.usuario;
  const podeGerenciar = podeEscrever(usuario, 'telemetria');

  const [periodo, setPeriodo] = useState('24');
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('Todos');
  const [filtroSeveridade, setFiltroSeveridade] = useState('');
  const [pagina, setPagina] = useState(1);

  const [eventos, setEventos] = useState([]);
  const [paginacao, setPaginacao] = useState({ total: 0, total_paginas: 1 });
  const [resumo, setResumo] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [excluindoLote, setExcluindoLote] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [importarAberto, setImportarAberto] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setBuscaDebounced(busca.trim()), 350);
    return () => clearTimeout(id);
  }, [busca]);

  const periodoAtual = PERIODOS.find((p) => p.id === periodo) || PERIODOS[0];
  const filtros = useMemo(() => ({
    horas: periodoAtual.horas,
    busca: buscaDebounced,
    severidade: filtroSeveridade,
    evento: TIPOS.find((t) => t.label === filtroTipo)?.eventos || [],
  }), [periodoAtual.horas, buscaDebounced, filtroSeveridade, filtroTipo]);

  useEffect(() => {
    setPagina(1);
    setSelectedIds([]);
  }, [filtros]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      // Cartões e painel lateral não dependem da pílula de tipo.
      const { evento, ...filtrosResumo } = filtros;
      const [lista, dadosResumo] = await Promise.all([
        fetch(`/api/telemetria?${paramsDosFiltros(filtros, { pagina, limite: POR_PAGINA })}`, { headers: obterHeaders() })
          .then((r) => lerJson(r, 'Erro ao buscar eventos de telemetria')),
        fetch(`/api/telemetria/resumo?${paramsDosFiltros(filtrosResumo)}`, { headers: obterHeaders() })
          .then((r) => lerJson(r, 'Erro ao buscar o resumo de telemetria')),
      ]);
      setEventos(lista.eventos || []);
      setPaginacao(lista.paginacao || { total: 0, total_paginas: 1 });
      setResumo(dadosResumo);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [filtros, pagina]);

  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  const atualizar = () => {
    setSelectedIds([]);
    setVersao((v) => v + 1);
  };

  // Seleção em lote
  const idsVisiveis = eventos.map((e) => e.id);
  const todosSelecionados = idsVisiveis.length > 0 && idsVisiveis.every((id) => selectedIds.includes(id));

  function toggleSelecionarTodos() {
    setSelectedIds((prev) => (todosSelecionados
      ? prev.filter((id) => !idsVisiveis.includes(id))
      : [...new Set([...prev, ...idsVisiveis])]));
  }

  function toggleSelecionarItem(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function excluirLote() {
    if (!selectedIds.length) return;
    const n = selectedIds.length;
    if (!window.confirm(`Tem certeza que deseja excluir ${n} ${n === 1 ? 'evento' : 'eventos'} de telemetria? Esta ação não pode ser desfeita.`)) return;
    setExcluindoLote(true);
    try {
      await lerJson(
        await fetch('/api/telemetria/excluir-lote', { method: 'POST', headers: obterHeaders(true), body: JSON.stringify({ ids: selectedIds }) }),
        'Falha ao excluir eventos',
      );
      atualizar();
    } catch (e) {
      alert(e.message);
    } finally {
      setExcluindoLote(false);
    }
  }

  async function exportarCsv() {
    setExportando(true);
    try {
      const todos = [];
      let pag = 1;
      let totalPaginas = 1;
      do {
        const dados = await lerJson(
          await fetch(`/api/telemetria?${paramsDosFiltros(filtros, { pagina: pag, limite: 200 })}`, { headers: obterHeaders() }),
          'Erro ao exportar',
        );
        todos.push(...(dados.eventos || []));
        totalPaginas = dados.paginacao?.total_paginas || 1;
        pag += 1;
      } while (pag <= totalPaginas && todos.length < 20000);
      if (!todos.length) {
        alert('Nenhum evento no filtro atual para exportar.');
        return;
      }
      baixar(gerarCsv(todos), `telemetria_eventos_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      alert(e.message);
    } finally {
      setExportando(false);
    }
  }

  function abrirTracker() {
    if (!URL_TRACKER) {
      alert('Endereço do Tracker não configurado. Defina VITE_TRACKER_URL no .env do frontend.');
      return;
    }
    window.open(URL_TRACKER, '_blank', 'noopener,noreferrer');
  }

  const kpis = resumo?.kpis || { total: 0, graves: 0, fadiga: 0, velocidade: 0, anterior: null };
  const anterior = kpis.anterior;
  const top5 = resumo?.top_veiculos || [];
  const alertas = resumo?.alerta_risco_hoje || [];
  const maiorTop = top5[0]?.total || 1;
  const sufixoPeriodo = periodoAtual.horas === 24 ? '(24h)' : `(${periodoAtual.label})`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-omega-accent">Seguranca & Comportamento</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-omega-900 sm:text-3xl">Telemetria & Fadiga</h1>
          <p className="mt-1 text-sm text-omega-500">
            Eventos de telemetria cruzados automaticamente com a TAG pela placa do veiculo, classificados pelo PGS-007245 (Anexo I).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="input w-auto" aria-label="Período">
            {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button type="button" className="btn-secondary" onClick={atualizar} title="Recarregar os dados">
            <RefreshCw size={16} className={carregando ? 'animate-spin' : ''} /> Atualizar
          </button>
          {podeGerenciar && (
            <>
              <button type="button" className="btn-secondary" onClick={gerarModeloTelemetria}>
                📥 Baixar Planilha Modelo (.xlsx)
              </button>
              <button type="button" className="btn-omega-red" onClick={() => setImportarAberto(true)}>
                + Importar Planilha de Telemetria
              </button>
            </>
          )}
          <button type="button" className="btn-secondary" onClick={exportarCsv} disabled={exportando}>
            {exportando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Exportar CSV
          </button>
          <button type="button" className="btn-primary" onClick={abrirTracker}>
            <Radio size={16} /> Abrir Tracker
          </button>
        </div>
      </div>

      {erro && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-status-vermelho">
          <AlertCircle size={16} className="shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={`Total de Eventos ${sufixoPeriodo}`}
          value={kpis.total}
          icon={Gauge}
          iconBg="bg-omega-900"
          sub="Todos os veiculos monitorados"
          {...tendencia(kpis.total, anterior?.total)}
        />
        <StatCard
          title="Infracoes Graves"
          value={kpis.graves}
          icon={AlertTriangle}
          iconBg="bg-status-vermelho"
          sub="Graves e criticas (Anexo I)"
          {...tendencia(kpis.graves, anterior?.graves)}
        />
        <StatCard
          title="Casos de Fadiga"
          value={kpis.fadiga}
          icon={Moon}
          iconBg="bg-status-amarelo"
          sub={resumo?.fadiga?.sem_parada_obrigatoria
            ? `${resumo.fadiga.sem_parada_obrigatoria} sem parada obrigatoria`
            : 'Sinais de sono e paradas excedidas'}
          {...tendencia(kpis.fadiga, anterior?.fadiga)}
        />
        <StatCard
          title="Excesso de Velocidade"
          value={kpis.velocidade}
          icon={Zap}
          iconBg="bg-omega-accent"
          sub="Acima do limite da via"
          {...tendencia(kpis.velocidade, anterior?.velocidade)}
        />
      </div>

      {/* Painel lateral ao lado só em telas largas; abaixo disso vai para baixo da tabela, que precisa da largura. */}
      <div className="grid grid-cols-1 gap-6 min-[1700px]:grid-cols-3">
        <div className="card space-y-4 p-5 min-[1700px]:col-span-2">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <h3 className="font-bold text-omega-900">Historico de Eventos</h3>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative sm:max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} className="input pl-9" placeholder="TAG, placa ou local..." />
              </div>
              <select value={filtroSeveridade} onChange={(e) => setFiltroSeveridade(e.target.value)} className="input sm:max-w-[170px]" aria-label="Severidade">
                <option value="">Todas severidades</option>
                {SEVERIDADES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {TIPOS.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => setFiltroTipo(t.label)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  filtroTipo === t.label ? 'bg-omega-900 text-white' : 'bg-omega-100 text-omega-700 hover:bg-omega-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {podeGerenciar && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-status-vermelho">
                <CheckSquare size={16} />
                {selectedIds.length} {selectedIds.length === 1 ? 'evento selecionado' : 'eventos selecionados'}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSelectedIds([])} className="btn-secondary px-3 py-1.5 text-xs">Limpar seleção</button>
                <button type="button" onClick={excluirLote} disabled={excluindoLote} className="btn-danger px-3 py-1.5 text-xs">
                  {excluindoLote ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Excluir Selecionados
                </button>
              </div>
            </div>
          )}

          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-omega-50 text-left text-xs font-semibold uppercase tracking-wider text-omega-500">
                <tr>
                  {podeGerenciar && (
                    <th className="w-10 rounded-tl-xl py-3 pl-3">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos os eventos da página"
                        className="h-4 w-4 rounded border-omega-300"
                        checked={todosSelecionados}
                        onChange={toggleSelecionarTodos}
                      />
                    </th>
                  )}
                  <th className={`py-3 pr-4 ${podeGerenciar ? '' : 'rounded-tl-xl pl-3'}`}>Data / Hora</th>
                  <th className="py-3 pr-4">TAG x Placa</th>
                  <th className="py-3 pr-4">Evento</th>
                  <th className="py-3 pr-4">Valor / Limite</th>
                  <th className="py-3 pr-4">Localizacao</th>
                  <th className="rounded-tr-xl py-3 pr-3 text-right">Severidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-omega-100">
                {carregando && eventos.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-omega-500"><Loader2 size={20} className="mx-auto animate-spin" /></td></tr>
                )}
                {eventos.map((e) => {
                  const marcado = selectedIds.includes(e.id);
                  const vl = valorLimite(e);
                  return (
                    <tr key={e.id} className={marcado ? 'bg-blue-50' : 'hover:bg-omega-50'}>
                      {podeGerenciar && (
                        <td className="py-3 pl-3 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Selecionar evento ${e.tag || e.tag_placa}`}
                            className="h-4 w-4 rounded border-omega-300"
                            checked={marcado}
                            onChange={() => toggleSelecionarItem(e.id)}
                          />
                        </td>
                      )}
                      <td className={`whitespace-nowrap py-3 pr-4 align-top tabular-nums text-omega-700 ${podeGerenciar ? '' : 'pl-3'}`}>
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} className="text-omega-400" />
                          {formatarDataHora(e.data_hora)}
                        </div>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-omega-100 text-omega-700">
                            <Truck size={14} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold leading-tight text-omega-900">{e.tag || 'Sem TAG'}</div>
                            <div className="font-mono text-[11px] leading-tight text-omega-500">{e.tag_placa}</div>
                            {e.motorista && <div className="max-w-[180px] truncate text-[11px] text-omega-400" title={e.motorista}>{e.motorista}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <div className="font-semibold text-omega-800">{e.evento}</div>
                        {e.ocorrencia_no_mes > 1 && (
                          <div className="text-[11px] font-semibold text-status-vermelho" title={e.medida_recomendada || ''}>
                            {e.ocorrencia_no_mes}ª no mês
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <div className="tabular-nums">
                          <span className="font-semibold text-status-vermelho">{vl.valor}</span>
                          {vl.limite && <><span className="mx-1 text-omega-400">/</span><span className="text-omega-500">{vl.limite}</span></>}
                        </div>
                        {(e.percentual_excesso > 0 || e.duracao_s) && (
                          <div className="text-[11px] text-omega-400">
                            {e.percentual_excesso > 0 && `+${e.percentual_excesso.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
                            {e.percentual_excesso > 0 && e.duracao_s ? ' · ' : ''}
                            {e.duracao_s ? `${e.duracao_s}s acima` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 align-top">
                        {e.link_mapa ? (
                          <a
                            href={e.link_mapa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex max-w-[240px] items-start gap-1.5 text-omega-600 hover:text-omega-accent"
                            title="Abrir no mapa"
                          >
                            <MapPin size={12} className="mt-1 shrink-0 text-omega-accent" />
                            <span className="text-xs leading-snug">{e.localizacao || `${e.latitude}, ${e.longitude}`}</span>
                          </a>
                        ) : (
                          <div className="flex max-w-[240px] items-start gap-1.5 text-omega-600">
                            <MapPin size={12} className="mt-1 shrink-0 text-omega-400" />
                            <span className="text-xs leading-snug">{e.localizacao || '—'}</span>
                          </div>
                        )}
                        {e.cerca && <div className="ml-[18px] text-[11px] text-omega-400">{e.cerca}</div>}
                      </td>
                      <td className="py-3 pr-3 text-right align-top">
                        <BadgeStatus status={e.severidade} />
                        {e.classificacao && <div className="mt-1 text-[10px] font-bold text-omega-400">{e.classificacao}</div>}
                      </td>
                    </tr>
                  );
                })}
                {!carregando && eventos.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-omega-500">
                      Nenhum evento encontrado. Amplie o período ou importe a planilha da plataforma de telemetria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {paginacao.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-omega-500">
              <span>
                {((pagina - 1) * POR_PAGINA + 1).toLocaleString('pt-BR')}–{Math.min(pagina * POR_PAGINA, paginacao.total).toLocaleString('pt-BR')} de{' '}
                {paginacao.total.toLocaleString('pt-BR')} eventos
              </span>
              <div className="flex items-center gap-1">
                <button type="button" className="btn-secondary px-2 py-1" aria-label="Página anterior" disabled={pagina <= 1 || carregando} onClick={() => setPagina((p) => p - 1)}>
                  <ChevronLeft size={16} />
                </button>
                <span className="px-2 tabular-nums">{pagina} / {paginacao.total_paginas}</span>
                <button type="button" className="btn-secondary px-2 py-1" aria-label="Próxima página" disabled={pagina >= paginacao.total_paginas || carregando} onClick={() => setPagina((p) => p + 1)}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="grid content-start gap-6 md:grid-cols-2 min-[1700px]:grid-cols-1">
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-omega-900">Top 5 — Mais Infracoes</h3>
              <TrendingDown size={18} className="text-status-vermelho" />
            </div>
            <ul className="space-y-3">
              {top5.map((veic, idx) => (
                <li key={veic.placa} className="flex items-center gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-omega-900 text-xs font-bold text-white">{idx + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate">
                        <span className="text-sm font-bold text-omega-900">{veic.tag || 'Sem TAG'}</span>
                        <span className="ml-2 font-mono text-[11px] text-omega-500">{veic.placa}</span>
                      </div>
                      <div className="shrink-0 text-sm font-extrabold tabular-nums text-omega-900">{veic.total}</div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-omega-100">
                      <div
                        className={`h-full rounded-full ${veic.graves >= 2 ? 'bg-status-vermelho' : veic.graves >= 1 ? 'bg-status-amarelo' : 'bg-omega-accent'}`}
                        style={{ width: `${Math.max(6, (veic.total / maiorTop) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-omega-500">
                      <span className="font-semibold text-status-vermelho">{veic.graves} grave(s)</span>
                      <span>{veic.total - veic.graves} outras</span>
                    </div>
                  </div>
                </li>
              ))}
              {!top5.length && (
                <li className="rounded-xl border border-dashed border-omega-200 p-4 text-center text-sm text-omega-500">
                  Nenhuma infracao no periodo.
                </li>
              )}
            </ul>
          </div>

          <div className="card bg-gradient-to-br from-omega-900 to-omega-800 p-5 text-white">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle size={18} className="text-status-amarelo" />
              <h3 className="font-bold">Alerta de Risco — Hoje</h3>
              {alertas.length > 0 && (
                <span className="ml-auto rounded-full bg-status-vermelho px-2 py-0.5 text-[11px] font-bold">{alertas.length}</span>
              )}
            </div>
            {alertas.length === 0 ? (
              <p className="text-sm leading-relaxed text-omega-300">
                Nenhum evento grave ou critico hoje.
              </p>
            ) : (
              <ul className="space-y-2">
                {alertas.map((a) => (
                  <li key={a.motorista || a.placa} className="rounded-lg bg-white/10 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold" title={a.motorista || ''}>{a.motorista || 'Motorista nao identificado'}</div>
                        <div className="text-[11px] text-omega-300">{a.tag || a.placa} · {a.ultimo_evento}</div>
                      </div>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${a.criticos ? 'bg-status-vermelho' : 'bg-status-amarelo text-omega-900'}`}>
                        {a.eventos} {a.eventos > 1 ? 'eventos' : 'evento'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-omega-400">Ultimo: {formatarDataHora(a.ultimo_horario)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <ModalImportar aberto={importarAberto} onFechar={() => setImportarAberto(false)} onImportado={atualizar} />
    </div>
  );
}
