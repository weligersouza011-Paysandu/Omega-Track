import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, Eye, Pencil, Trash2, X, RefreshCw, AlertTriangle,
  CheckCircle2, ClipboardList, Filter, FileText, Loader2,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import BadgeStatus from '../components/BadgeStatus.jsx';
import ParteDiariaForm from '../components/ParteDiariaForm.jsx';
import RelatorioParteDiariaPreview from '../components/RelatorioParteDiariaPreview.jsx';
import { authHeaders } from '../utils/sessao.js';
import { podeVerTodasPartes, ehMaster } from '../utils/permissoes.js';

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatarData(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function paraInputData(valor) {
  if (!valor) return hojeISO();
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return hojeISO();
  return d.toISOString().slice(0, 10);
}

function normalizar(v) {
  return String(v || '').trim().toUpperCase();
}

// Registro pertence ao usuario logado? (matricula no campo operador
// ou nome no campo funcionario — cobre os dois formatos de lancamento).
function pertenceAoUsuario(p, usuario) {
  if (!usuario) return false;
  const mat = normalizar(usuario.matricula);
  const nome = normalizar(usuario.nome);
  const operador = normalizar(p?.operador);
  const funcionario = normalizar(p?.funcionario);
  if (mat && operador === mat) return true;
  if (mat && funcionario.includes(mat)) return true;
  if (nome && funcionario && (funcionario === nome || funcionario.includes(nome) || nome.includes(funcionario))) return true;
  return false;
}

export default function HomePartesDiariasView({ sessao }) {
  const usuario = sessao?.usuario || null;
  const visaoTotal = podeVerTodasPartes(usuario);
  const souMaster = ehMaster(usuario);

  const [partes, setPartes] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroAssinatura, setFiltroAssinatura] = useState('todos');
  const [filtroData, setFiltroData] = useState('');

  const [detalhe, setDetalhe] = useState(null);
  // Formulario completo (modelo Omega Service): { aberto: bool, id: string|null }
  const [formState, setFormState] = useState({ aberto: false, id: null });
  const [toast, setToast] = useState(null);
  // Exclusão (somente MASTER): parte alvo da confirmação + estado de envio.
  const [excluir, setExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  // Relatório oficial PDF/HTML
  const [relatorioPreview, setRelatorioPreview] = useState(null);
  const [carregandoRelatorioId, setCarregandoRelatorioId] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchPartesDiarias = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ limit: '100', _t: String(Date.now()) });
      // Otimizacao: operacional ja pede so os proprios ao backend.
      // O filtro client-side abaixo reaplica a regra por seguranca.
      if (!visaoTotal && usuario?.matricula) params.set('operador', String(usuario.matricula));
      const resp = await fetch(`/api/partes-diarias?${params.toString()}`, {
        headers: {
          ...authHeaders(sessao),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });
      if (!resp.ok) throw new Error(`API respondeu ${resp.status}`);
      const corpo = await resp.json();
      const lista = Array.isArray(corpo?.data) ? corpo.data : [];
      setPartes(lista);
      return lista;
    } catch {
      setErro('Não foi possível carregar as Partes Diárias. Verifique se o backend está no ar.');
      return [];
    } finally {
      setCarregando(false);
    }
  };

  const carregar = fetchPartesDiarias;

  const carregarVeiculos = async () => {
    try {
      const resp = await fetch('/api/mob-desmob?limit=200');
      if (!resp.ok) return;
      const { data } = await resp.json();
      if (Array.isArray(data)) setVeiculos(data);
    } catch {
      /* TAG segue como campo livre */
    }
  };

  useEffect(() => {
    carregar();
    carregarVeiculos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regra de visibilidade por perfil (CRITICO):
  // ADM / Gestao / Transporte (ADMINISTRADOR) veem tudo;
  // Operacional ve apenas os proprios lancamentos.
  const visiveis = useMemo(() => {
    const base = visaoTotal ? partes : partes.filter((p) => pertenceAoUsuario(p, usuario));
    const q = busca.trim().toUpperCase();
    return base.filter((p) => {
      if (filtroStatus !== 'todos' && (p.status_aprovacao || p.status) !== filtroStatus) return false;
      if (filtroAssinatura !== 'todos' && p.status_assinatura !== filtroAssinatura) return false;
      if (filtroData && paraInputData(p.data) !== filtroData) return false;
      if (!q) return true;
      const placa = p.veiculo?.placa || p.placa || '';
      return [p.tag, placa, p.funcionario, p.operador, p.obra, p.lideranca, p.id_relatorio]
        .some((v) => String(v || '').toUpperCase().includes(q));
    });
  }, [partes, visaoTotal, usuario, busca, filtroStatus, filtroAssinatura, filtroData]);

  const statusDisponiveis = useMemo(() => {
    const set = new Set(partes.map((p) => p.status_aprovacao || p.status).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [partes]);

  const placaPorTag = useMemo(() => {
    const map = new Map();
    veiculos.forEach((v) => { if (v?.tag) map.set(normalizar(v.tag), v.placa || ''); });
    return map;
  }, [veiculos]);

  const abrirNovo = () => {
    setFormState({ aberto: true, id: null });
  };

  const abrirEdicao = (p) => {
    setFormState({ aberto: true, id: p.id });
  };

  const podeEditar = (p) => visaoTotal || pertenceAoUsuario(p, usuario);

  const aoSalvarForm = async (msg, opts) => {
    // Feedback visual de sucesso: fecha o modal do formulário e exibe o toast.
    // Assinaturas de etapa passam { manterAberto: true } para seguir no formulário.
    if (!opts?.manterAberto) setFormState({ aberto: false, id: null });
    setToast(msg || 'Parte Diária salva com sucesso!');

    // Atualização imediata do estado local do React com o registro salvo retornado
    if (opts?.salvo && opts.salvo.id) {
      setPartes((anteriores) => {
        const existe = anteriores.some((p) => p.id === opts.salvo.id);
        if (existe) {
          return anteriores.map((p) => (p.id === opts.salvo.id ? { ...p, ...opts.salvo } : p));
        }
        return [opts.salvo, ...anteriores];
      });
    }

    // Dispara obrigatoriamente a recarga completa dos dados da listagem da API
    await fetchPartesDiarias();
  };

  const confirmarExcluir = async () => {
    if (!excluir || excluindo) return;
    setExcluindo(true);
    try {
      const resp = await fetch(`/api/partes-diarias/${excluir.id}`, {
        method: 'DELETE',
        headers: authHeaders(sessao),
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.message || `Falha ao excluir (API ${resp.status})`);
      }
      setPartes((anteriores) => anteriores.filter((p) => p.id !== excluir.id));
      setExcluir(null);
      setToast('Parte Diária excluída com sucesso!');
      await fetchPartesDiarias();
    } catch (e) {
      setToast(`Falha ao excluir: ${e.message}`);
    } finally {
      setExcluindo(false);
    }
  };

  const abrirRelatorio = async (p) => {
    if (!p?.id) return;
    setCarregandoRelatorioId(p.id);
    try {
      const resp = await fetch(`/api/partes-diarias/${p.id}`, {
        headers: authHeaders(sessao),
      });
      if (!resp.ok) throw new Error(`Falha ao carregar relatório (${resp.status})`);
      const corpo = await resp.json();
      const completo = corpo?.data || p;
      setRelatorioPreview(completo);
    } catch (e) {
      setToast(`Erro ao carregar relatório: ${e.message}`);
    } finally {
      setCarregandoRelatorioId(null);
    }
  };

  const limparFiltros = () => {
    setBusca('');
    setFiltroStatus('todos');
    setFiltroAssinatura('todos');
    setFiltroData('');
  };
  const temFiltro = busca.trim() !== '' || filtroStatus !== 'todos' || filtroAssinatura !== 'todos' || filtroData !== '';

  return (
    <div className="space-y-3 md:space-y-5">
      {/* Cabecalho + acao rapida */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-2 md:gap-3">
        <div>
          <div className="text-[11px] md:text-xs font-semibold text-omega-accent uppercase tracking-wider">Transporte</div>
          <h1 className="mt-0.5 text-lg md:text-2xl font-extrabold text-omega-900 tracking-tight">
            Início — Partes Diárias
          </h1>
          <p className="mt-0.5 md:mt-1 text-xs md:text-sm text-omega-500">
            {visaoTotal
              ? 'Visão geral da operação: todas as Partes Diárias cadastradas.'
              : 'Seus lançamentos: você visualiza apenas as Partes Diárias que cadastrou.'}
          </p>
        </div>
        <button onClick={abrirNovo} className="btn-primary !py-2 text-sm shrink-0">
          <Plus size={16} /> Adicionar Parte Diária
        </button>
      </div>

      {/* Filtros */}
      <div className="card p-3 md:p-4 flex flex-col md:flex-row gap-2 md:gap-3 md:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="input pl-9"
            placeholder="Buscar TAG, placa, operador, obra..."
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="input !w-auto" title="Status">
            <option value="todos">Todos os status</option>
            {statusDisponiveis.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={filtroAssinatura} onChange={(e) => setFiltroAssinatura(e.target.value)} className="input !w-auto" title="Assinatura">
            <option value="todos">Todas assinaturas</option>
            <option value="PENDENTE">Pendente</option>
            <option value="ASSINADO">Assinado</option>
          </select>
          <input
            type="date"
            value={filtroData}
            onChange={(e) => setFiltroData(e.target.value)}
            className="input !w-auto"
            title="Filtrar por data"
          />
          {temFiltro && (
            <button onClick={limparFiltros} className="btn-secondary !py-2 text-xs" title="Limpar filtros">
              <X size={14} /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-omega-100 bg-omega-50/50 flex items-center gap-2">
          <Filter size={14} className="text-omega-500" />
          <span className="text-sm font-bold text-omega-900">Partes Diárias</span>
          <span className="text-[11px] text-omega-500 ml-auto">
            {visiveis.length} registro(s){!visaoTotal ? ' • meus lançamentos' : ''}
          </span>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center p-10 text-omega-500 text-sm font-semibold">
            <RefreshCw size={20} className="animate-spin mr-2" /> Carregando Partes Diárias...
          </div>
        ) : erro ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="mx-auto text-status-amarelo mb-2" />
            <div className="text-sm font-semibold text-omega-700 mb-1">Falha ao carregar</div>
            <div className="text-xs text-omega-500 mb-4">{erro}</div>
            <button onClick={carregar} className="btn-secondary !py-2 text-xs inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Tentar novamente
            </button>
          </div>
        ) : visiveis.length === 0 ? (
          <div className="p-10 text-center text-omega-500">
            <ClipboardList size={36} className="mx-auto text-omega-300 mb-3" />
            <div className="text-sm font-semibold text-omega-700 mb-1">
              {temFiltro ? 'Nenhum registro neste filtro' : 'Nenhuma Parte Diária lançada'}
            </div>
            <div className="text-xs mb-4">
              {temFiltro
                ? 'Ajuste os filtros ou limpe a busca.'
                : visaoTotal
                  ? 'Utilize o botão Adicionar Parte Diária para iniciar os lançamentos.'
                  : 'Você ainda não possui lançamentos. Utilize o botão acima para criar o primeiro.'}
            </div>
            {temFiltro
              ? <button onClick={limparFiltros} className="btn-secondary !py-2 text-xs">Limpar filtros</button>
              : <button onClick={abrirNovo} className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5"><Plus size={14} /> Adicionar Parte Diária</button>}
          </div>
        ) : (
          <>
          {/* Cards mobile (sm): Data + Status / TAG-Placa + KM / ações rápidas */}
          <div className="md:hidden divide-y divide-omega-100">
            {visiveis.map((p) => {
              const placa = p.veiculo?.placa || placaPorTag.get(normalizar(p.tag)) || '—';
              const kmI = p.km_inicial ?? p.kmInicial ?? null;
              const kmF = p.km_final ?? p.kmFinal ?? null;
              const editavel = podeEditar(p);
              return (
                <div key={p.id} className="px-4 py-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-omega-900 tabular-nums text-sm">{formatarData(p.data)}</span>
                    <BadgeStatus status={p.status_aprovacao || p.status} />
                  </div>
                  {p.possui_pendencia && (
                    <span className="inline-block chip bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-600/25" title="Checklist sem foto ou atividade pendente">
                      Pendente
                    </span>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-omega-900 text-sm truncate">{p.tag}</div>
                      <div className="text-xs text-omega-500 font-mono">{placa}</div>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-omega-400">KM Ini / Fim</div>
                      <div className="text-xs text-omega-700 font-semibold">
                        {kmI == null && kmF == null ? '—' : `${kmI ?? '—'} / ${kmF ?? '—'}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 pt-2 border-t border-omega-100">
                    <button
                      onClick={() => abrirRelatorio(p)}
                      disabled={carregandoRelatorioId === p.id}
                      title="Relatório / PDF"
                      aria-label="Relatório / PDF"
                      className="p-2 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-accent disabled:opacity-50 transition-colors"
                    >
                      {carregandoRelatorioId === p.id ? (
                        <Loader2 size={17} className="animate-spin text-omega-accent" />
                      ) : (
                        <FileText size={17} />
                      )}
                    </button>
                    <button
                      onClick={() => setDetalhe(p)}
                      title="Visualizar"
                      aria-label="Visualizar"
                      className="p-2 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 transition-colors"
                    >
                      <Eye size={17} />
                    </button>
                    <button
                      onClick={() => editavel && abrirEdicao(p)}
                      disabled={!editavel}
                      title={editavel ? 'Editar' : 'Somente o autor ou ADM pode editar'}
                      aria-label="Editar"
                      className="p-2 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Pencil size={17} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Tabela desktop (inalterada) */}
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[960px]">
              <thead className="bg-omega-50/70">
                <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-bold border-b border-omega-100">
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Veículo (TAG / Placa)</th>
                  <th className="px-4 py-3">Operador (Nome / Matrícula)</th>
                  <th className="px-4 py-3">KM Inicial / Final</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-omega-100">
                {visiveis.map((p) => {
                  const placa = p.veiculo?.placa || placaPorTag.get(normalizar(p.tag)) || '—';
                  const kmI = p.km_inicial ?? p.kmInicial ?? null;
                  const kmF = p.km_final ?? p.kmFinal ?? null;
                  const editavel = podeEditar(p);
                  return (
                    <tr key={p.id} className="hover:bg-omega-50/60">
                      <td className="px-4 py-2.5">
                        <div className="font-bold text-omega-900 tabular-nums">{formatarData(p.data)}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-bold text-omega-900">{p.tag}</div>
                        <div className="text-xs text-omega-500 font-mono">{placa}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-omega-800 font-medium">{p.funcionario || '—'}</div>
                        <div className="text-xs text-omega-500 font-mono">Matr. {p.operador || '—'}</div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-omega-700">
                        {kmI == null && kmF == null ? '—' : `${kmI ?? '—'} / ${kmF ?? '—'}`}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <BadgeStatus status={p.status_aprovacao || p.status} />
                          {p.possui_pendencia && (
                            <span className="chip bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-600/25" title="Checklist sem foto ou atividade pendente">
                              Pendente
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => abrirRelatorio(p)}
                            disabled={carregandoRelatorioId === p.id}
                            title="Visualizar Relatório Oficial / Baixar PDF"
                            className="p-1.5 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-accent disabled:opacity-50 transition-colors"
                          >
                            {carregandoRelatorioId === p.id ? (
                              <Loader2 size={15} className="animate-spin text-omega-accent" />
                            ) : (
                              <FileText size={15} />
                            )}
                          </button>
                          <button
                            onClick={() => setDetalhe(p)}
                            title="Visualizar"
                            className="p-1.5 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 transition-colors"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={() => editavel && abrirEdicao(p)}
                            disabled={!editavel}
                            title={editavel ? 'Editar' : 'Somente o autor ou ADM pode editar'}
                            className="p-1.5 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <Pencil size={15} />
                          </button>
                          {souMaster && (
                            <button
                              onClick={() => setExcluir(p)}
                              title="Excluir (somente Master)"
                              className="p-1.5 rounded-md hover:bg-red-50 text-omega-400 hover:text-status-vermelho transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Modal visualizar */}
      <Modal
        open={!!detalhe}
        onClose={() => setDetalhe(null)}
        title={`Parte Diária • ${detalhe?.tag || ''}`}
        subtitle={detalhe ? `${formatarData(detalhe.data)} • ${detalhe.funcionario || '—'}` : ''}
        size="md"
        footer={
          <>
            <button
              onClick={() => {
                const p = detalhe;
                abrirRelatorio(p);
              }}
              disabled={carregandoRelatorioId === detalhe?.id}
              className="btn-secondary inline-flex items-center gap-1.5"
              title="Abrir relatório oficial para impressão ou download em PDF"
            >
              {carregandoRelatorioId === detalhe?.id ? (
                <><Loader2 size={15} className="animate-spin" /> Carregando...</>
              ) : (
                <><FileText size={15} /> Relatório / PDF</>
              )}
            </button>
            {(detalhe && podeEditar(detalhe)) && (
              <button
                onClick={() => { const p = detalhe; setDetalhe(null); abrirEdicao(p); }}
                className="btn-primary"
              >
                <Pencil size={15} /> Editar
              </button>
            )}
            <button onClick={() => setDetalhe(null)} className="btn-secondary">Fechar</button>
          </>
        }
      >
        {detalhe && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {[
              ['Data', formatarData(detalhe.data)],
              ['Turno', detalhe.turno || '—'],
              ['TAG', detalhe.tag],
              ['Placa', detalhe.veiculo?.placa || placaPorTag.get(normalizar(detalhe.tag)) || '—'],
              ['Operador', detalhe.funcionario || '—'],
              ['Matrícula', detalhe.operador || '—'],
              ['Função', detalhe.funcao || '—'],
              ['Obra', detalhe.obra || '—'],
              ['Obra programada', detalhe.obra_programada || '—'],
              ['KM Inicial', detalhe.km_inicial ?? detalhe.kmInicial ?? '—'],
              ['KM Final', detalhe.km_final ?? detalhe.kmFinal ?? '—'],
              ['Liderança', detalhe.lideranca || '—'],
              ['Relatório Nº', detalhe.numero_relatorio || detalhe.id_relatorio || '—'],
              ['Contrato', detalhe.numero_contrato || '—'],
              ['Contratante', detalhe.contratante || '—'],
              ['Responsável', detalhe.responsavel || '—'],
              ['Planejador', detalhe.planejador || detalhe.obra_ref?.planejador || '—'],
              ['Jornada', `${detalhe.horario_entrada || '—'} → ${detalhe.horario_saida || '—'}`],
              ['Intervalo', `${detalhe.intervalo_entrada || '—'} → ${detalhe.intervalo_saida || '—'}`],
              ['Eficiência', detalhe.eficiencia ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-omega-100 bg-omega-50/50 px-3 py-2">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-omega-500">{k}</dt>
                <dd className="mt-0.5 font-semibold text-omega-900">{String(v)}</dd>
              </div>
            ))}
            <div className="rounded-xl border border-omega-100 bg-omega-50/50 px-3 py-2">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-omega-500">Status</dt>
              <dd className="mt-1 flex gap-1 flex-wrap">
                <BadgeStatus status={detalhe.status_aprovacao || detalhe.status} />
                <BadgeStatus status={detalhe.status_assinatura} />
                {detalhe.status_relatorio && <BadgeStatus status={detalhe.status_relatorio} />}
                {detalhe.possui_pendencia && (
                  <span className="chip bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-600/25" title="Checklist sem foto ou atividade pendente">
                    Pendente
                  </span>
                )}
              </dd>
            </div>
            {detalhe._count && (
              <div className="rounded-xl border border-omega-100 bg-omega-50/50 px-3 py-2 sm:col-span-2">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-omega-500">Módulos do relatório</dt>
                <dd className="mt-1 text-xs font-semibold text-omega-700">
                  Mão de obra ({detalhe._count.mao_obra ?? 0}) • Equipamentos ({detalhe._count.equipamentos ?? 0}) • Atividades ({detalhe._count.atividades ?? 0}) • Ocorrências ({detalhe._count.ocorrencias ?? 0}) • Checklist ({detalhe._count.checklist ?? 0}) • Comentários ({detalhe._count.comentarios ?? 0}) • Fotos ({detalhe._count.fotos ?? 0}) • Assinaturas ({detalhe._count.assinaturas ?? 0})
                </dd>
              </div>
            )}
          </dl>
        )}
      </Modal>

      {/* Formulário completo — Parte Diária, modelo Omega Service */}
      <ParteDiariaForm
        open={formState.aberto}
        onClose={() => {
          setFormState({ aberto: false, id: null });
          fetchPartesDiarias();
        }}
        sessao={sessao}
        veiculos={veiculos}
        inicial={formState.id ? { id: formState.id } : null}
        onSalvo={aoSalvarForm}
        onSave={aoSalvarForm}
      />

      {/* Confirmação de exclusão — somente MASTER enxerga o botão */}
      <Modal
        open={!!excluir}
        onClose={() => { if (!excluindo) setExcluir(null); }}
        title="Excluir Parte Diária"
        subtitle={excluir ? `${excluir.tag || ''} • ${formatarData(excluir.data)} • ${excluir.funcionario || '—'}` : ''}
        size="sm"
        footer={
          <>
            <button onClick={() => setExcluir(null)} disabled={excluindo} className="btn-secondary disabled:opacity-50">Cancelar</button>
            <button onClick={confirmarExcluir} disabled={excluindo} className="btn-danger disabled:opacity-50">
              {excluindo ? 'Excluindo...' : 'Excluir'}
            </button>
          </>
        }
      >
        <p className="text-sm text-omega-700">
          Remover esta Parte Diária do sistema? Esta ação não pode ser desfeita.
        </p>
      </Modal>

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-xl bg-omega-900 text-white shadow-2xl text-sm font-semibold max-w-md">
          <CheckCircle2 size={17} className="text-status-verde shrink-0" />
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="ml-1 hover:bg-white/15 rounded-full p-0.5">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Visualização e exportação direta do Relatório Oficial (PDF / Impressão) */}
      {relatorioPreview && (
        <RelatorioParteDiariaPreview
          relatorio={relatorioPreview}
          onFechar={() => setRelatorioPreview(null)}
        />
      )}

      {/* FAB mobile: nova Parte Diária (oculto com o modal aberto) */}
      {!formState.aberto && (
        <button
          onClick={abrirNovo}
          title="Adicionar Parte Diária"
          aria-label="Adicionar Parte Diária"
          className="md:hidden fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-omega-accent text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        >
          <Plus size={26} />
        </button>
      )}
    </div>
  );
}
