import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Filter, Download, X, LayoutGrid, BarChart3, FileText, CheckCircle2, RefreshCw, AlertTriangle, Briefcase, Loader2 } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import BadgeStatus from '../components/BadgeStatus.jsx';
import VehicleDetailPanel from '../components/VehicleDetailPanel.jsx';
import EditVehicleModal from '../components/EditVehicleModal.jsx';
import CampoListaComCriador from '../components/CampoListaComCriador.jsx';
import DashboardExecutivoView from './DashboardExecutivoView.jsx';
import DocumentManagementView from './DocumentManagementView.jsx';
import { veiculos as initialVeiculos } from '../data/mockData.js';

const FILTROS_RAPIDOS = [
  { key: 'todos', label: 'Todos', icon: null, cor: null },
  { key: 'Mobilizado', label: 'Mobilizado (Ativo)', icon: CheckCircle2, cor: 'status-verde' },
  { key: 'Desmobilizado', label: 'Desmobilizado (Desativado)', icon: X, cor: 'status-vermelho' },
];

const ABAS = [
  { key: 'galeria', label: 'Galeria de Veículos', icon: LayoutGrid },
  { key: 'dashboard', label: 'Dashboard Executivo', icon: BarChart3 },
  { key: 'documentos', label: 'Controle de Documentação', icon: FileText },
];

function BarraAbas({ abaAtiva, onTrocar }) {
  return (
    <div className="flex items-center gap-2 border-b border-omega-200 pb-0.5 shrink-0 overflow-x-auto">
      {ABAS.map((aba) => {
        const ativo = abaAtiva === aba.key;
        return (
          <button
            key={aba.key}
            onClick={() => onTrocar(aba.key)}
            className={
              'flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-t-lg transition-all -mb-px whitespace-nowrap ' +
              (ativo
                ? 'bg-white border border-b-0 border-omega-200 text-omega-900 shadow-[0_-1px_0_0_rgba(37,99,235,0.5)_inset]'
                : 'text-omega-500 hover:text-omega-800 hover:bg-omega-100/50 border border-transparent')
            }
          >
            <aba.icon size={16} />
            {aba.label}
          </button>
        );
      })}
    </div>
  );
}

export default function MobDesmobView() {
  const [veiculos, setVeiculos] = useState(initialVeiculos);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('Mobilizado');
  const [filtroContrato, setFiltroContrato] = useState('todos');
  const [abaAtiva, setAbaAtiva] = useState('galeria');
  const [veiculoSelecionado, setVeiculoSelecionado] = useState(null);
  const [modalCadastro, setModalCadastro] = useState(false);
  const [modalEdicao, setModalEdicao] = useState(null);
  const [toast, setToast] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [modalDesmob, setModalDesmob] = useState(null);
  const [form, setForm] = useState({ tag: '', placa: '', modelo: '', contrato: '', status: 'Mobilizado', data_mob: new Date().toISOString().slice(0, 10) });
  const [dataDesmob, setDataDesmob] = useState(new Date().toISOString().slice(0, 10));
  const [motivoDesmob, setMotivoDesmob] = useState('');
  const [desmobilizando, setDesmobilizando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erroApi, setErroApi] = useState(null);

  // Galeria alimentada pelo backend (Neon) — fotos reais via Cloudinary.
  const carregarVeiculos = async () => {
    setCarregando(true);
    setErroApi(null);
    try {
      const resp = await fetch('/api/mob-desmob?limit=200');
      if (!resp.ok) throw new Error(`API respondeu ${resp.status}`);
      const { data } = await resp.json();
      setVeiculos(Array.isArray(data) ? data : []);
    } catch (e) {
      setErroApi('Não foi possível carregar a frota da API. Verifique se o backend está no ar.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregarVeiculos(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const normalizarContrato = (raw) => {
    const t = String(raw || '').trim();
    return t === '' ? 'Sem contrato' : t;
  };

  const passaBusca = (v, q) => {
    if (!q) return true;
    return (
      (v.tag || '').toUpperCase().includes(q) ||
      (v.placa || '').toUpperCase().includes(q) ||
      (v.modelo || '').toUpperCase().includes(q) ||
      (v.contrato || '').toUpperCase().includes(q)
    );
  };

  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return veiculos.filter(v => {
      if (filtroStatus !== 'todos' && v.status !== filtroStatus) return false;
      if (filtroContrato !== 'todos' && normalizarContrato(v.contrato) !== filtroContrato) return false;
      return passaBusca(v, q);
    });
  }, [veiculos, busca, filtroStatus, filtroContrato]);

  // Contagem de status respeita contrato + busca (filtro acumulativo/facetado).
  const contagem = useMemo(() => {
    const q = busca.trim().toUpperCase();
    const base = veiculos.filter(v => {
      if (filtroContrato !== 'todos' && normalizarContrato(v.contrato) !== filtroContrato) return false;
      return passaBusca(v, q);
    });
    return {
      todos: base.length,
      Mobilizado: base.filter(v => v.status === 'Mobilizado').length,
      Desmobilizado: base.filter(v => v.status === 'Desmobilizado').length,
    };
  }, [veiculos, busca, filtroContrato]);

  // Agrupamento dinâmico de contratos respeita status + busca.
  // Normaliza com trim para unificar ex.: "Eletromecânica" vs "Eletromecânica ".
  const contratos = useMemo(() => {
    const q = busca.trim().toUpperCase();
    const base = veiculos.filter(v => {
      if (filtroStatus !== 'todos' && v.status !== filtroStatus) return false;
      return passaBusca(v, q);
    });
    const mapa = new Map();
    for (const v of base) {
      const nome = normalizarContrato(v.contrato);
      mapa.set(nome, (mapa.get(nome) || 0) + 1);
    }
    return [...mapa.entries()]
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [veiculos, busca, filtroStatus]);

  const totalContratos = useMemo(
    () => contratos.reduce((acc, c) => acc + c.total, 0),
    [contratos]
  );

  // Lista dinâmica de modelos/categorias já existentes (para o select com criador).
  const modelos = useMemo(() => {
    const mapa = new Map();
    for (const v of veiculos) {
      const nome = String(v.modelo || v.categoria || '').trim();
      if (nome !== '') mapa.set(nome, (mapa.get(nome) || 0) + 1);
    }
    return [...mapa.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [veiculos]);

  const [erroCadastro, setErroCadastro] = useState(null);

  const limparFiltros = () => {
    setFiltroStatus('todos');
    setFiltroContrato('todos');
    setBusca('');
  };
  const temFiltroAtivo = filtroStatus !== 'todos' || filtroContrato !== 'todos' || busca.trim() !== '';

  const salvarNovo = async () => {
    if (!form.tag.trim() || !form.placa.trim()) {
      setErroCadastro('TAG e Placa são obrigatórias.');
      return;
    }
    if (!String(form.modelo || '').trim()) {
      setErroCadastro('Modelo / Categoria é obrigatório.');
      return;
    }
    setErroCadastro(null);
    const payload = {
      ...form,
      tag: form.tag.trim(),
      placa: form.placa.toUpperCase().trim(),
      modelo: String(form.modelo).trim(),
      contrato: String(form.contrato || '').trim() || null,
    };
    try {
      const resp = await fetch('/api/mob-desmob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`API respondeu ${resp.status}`);
      const { data } = await resp.json();
      setVeiculos([data, ...veiculos]);
    } catch (e) {
      // Fallback offline: adiciona localmente sem foto até sincronizar.
      setVeiculos([{ ...payload, foto_veiculo: null, data_desmob: null }, ...veiculos]);
    }
    setModalCadastro(false);
    setForm({ tag: '', placa: '', modelo: '', contrato: '', status: 'Mobilizado', data_mob: new Date().toISOString().slice(0, 10) });
  };

  const confirmarDesmob = async () => {
    if (!modalDesmob || desmobilizando) return;
    setDesmobilizando(true);
    try {
      // Endpoint dedicado: atualiza status + data/responsavel/observacao e
      // purga documentos e anexos do controle de vencimentos (transacao).
      const resp = await fetch(`/api/mob-desmob/${encodeURIComponent(modalDesmob.tag)}/desmobilizar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_desmob: dataDesmob, observacao: motivoDesmob.trim() || null }),
      });
      if (!resp.ok) throw new Error(`API respondeu ${resp.status}`);
      const { data } = await resp.json();
      setVeiculos(veiculos.map(v => v.tag === data.veiculo.tag ? data.veiculo : v));
      setToast(
        `${data.veiculo.tag} desmobilizado. ${data.documentos_apagados} documento(s) e ${data.anexos_apagados} anexo(s) apagados do controle.`
      );
    } catch (e) {
      setVeiculos(veiculos.map(v =>
        v.tag === modalDesmob.tag ? { ...v, status: 'Desmobilizado', data_desmob: dataDesmob } : v
      ));
      setToast('Veículo desmobilizado localmente (falha na API — sincronize depois).');
    } finally {
      setDesmobilizando(false);
      setModalDesmob(null);
      setMotivoDesmob('');
    }
  };

  const selecionarVeiculo = (v) => {
    setVeiculoSelecionado(v);
  };

  const abrirEdicao = (v) => {
    setModalEdicao(v || veiculoSelecionado);
  };

  const aoSalvarEdicao = (atualizado) => {
    setVeiculos((lista) => lista.map((v) => (v.tag === atualizado.tag ? atualizado : v)));
    setVeiculoSelecionado(atualizado);
    setModalEdicao(null);
    setToast('Veículo atualizado com sucesso!');
  };

  const exportar = async () => {
    if (filtrados.length === 0 || exportando) return;
    setExportando(true);
    try {
      // Import dinâmico: ExcelJS (~1 MB) vai para chunk separado, carregado só ao exportar.
      const { exportarFrotaExcel } = await import('../utils/exportarFrota.js');
      const total = await exportarFrotaExcel(filtrados, {
        status: filtroStatus,
        contrato: filtroContrato,
        busca,
      });
      setToast(`Planilha exportada com sucesso! (${total} veículo(s))`);
    } catch (e) {
      setToast(`Falha ao exportar: ${e.message || 'tente novamente.'}`);
    } finally {
      setExportando(false);
    }
  };

  const listaVazia = !carregando && !erroApi && veiculos.length === 0;

  if (abaAtiva === 'dashboard') {
    return (
      <div className="space-y-5">
        <BarraAbas abaAtiva={abaAtiva} onTrocar={setAbaAtiva} />
        <DashboardExecutivoView />
      </div>
    );
  }

  if (abaAtiva === 'documentos') {
    return (
      <div className="space-y-5">
        <BarraAbas abaAtiva={abaAtiva} onTrocar={setAbaAtiva} />
        <DocumentManagementView veiculos={veiculos} />
      </div>
    );
  }

  const temSelecionado = !!veiculoSelecionado;

  return (
    <div className="space-y-4 h-[calc(100vh-10rem)] min-h-[600px] flex flex-col">
      <BarraAbas abaAtiva={abaAtiva} onTrocar={setAbaAtiva} />

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 shrink-0">
        <div>
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Controle de MOB e DESMOB</div>
          <h1 className="mt-0.5 text-xl font-extrabold text-omega-900 tracking-tight sm:text-2xl">
            Frota — Mobilizacao & Desmobilizacao
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportar}
            disabled={exportando || filtrados.length === 0}
            title={filtrados.length === 0 ? 'Nenhum veículo para exportar' : `Exportar ${filtrados.length} veículo(s) filtrado(s) para Excel`}
            className="btn-secondary !py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {exportando ? 'Exportando...' : 'Exportar'}
          </button>
          <button className="btn-primary !py-2 text-xs" onClick={() => setModalCadastro(true)}><Plus size={14} /> Adicionar</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
        <div className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">
          <div className="card p-2 space-y-1">
            <div className="text-[10px] font-bold text-omega-500 uppercase tracking-wider px-2 pt-1 pb-1.5">
              Status da Frota
            </div>
            {FILTROS_RAPIDOS.map(f => {
              const ativo = filtroStatus === f.key;
              const count = contagem[f.key] ?? 0;
              return (
                <button
                  key={f.key}
                  onClick={() => setFiltroStatus(f.key)}
                  className={
                    'w-full text-left px-2.5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-between gap-2 ' +
                    (ativo
                      ? f.key === 'Mobilizado'
                        ? 'bg-status-verde/10 text-omega-900 ring-1 ring-inset ring-status-verde/30'
                        : f.key === 'Desmobilizado'
                        ? 'bg-status-vermelho/10 text-omega-900 ring-1 ring-inset ring-status-vermelho/30'
                        : 'bg-omega-900 text-white ring-1 ring-inset ring-omega-900/30'
                      : 'text-omega-700 hover:bg-omega-50')
                  }
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {f.icon && <f.icon size={14} className={ativo ? (f.cor ? `text-${f.cor}` : '') : 'text-omega-500'} />}
                    {!f.icon && <span className="w-3.5" />}
                    <span className="truncate text-[12px]">{f.label}</span>
                  </span>
                  <span className={
                    'text-[11px] font-black tabular-nums px-1.5 py-0.5 rounded ' +
                    (ativo ? 'bg-white/60 text-omega-900' : 'bg-omega-100 text-omega-600')
                  }>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="card p-2 space-y-1">
            <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-omega-500 uppercase tracking-wider">
                <Briefcase size={12} />
                Contrato
              </div>
              {filtroContrato !== 'todos' && (
                <button
                  onClick={() => setFiltroContrato('todos')}
                  title="Limpar filtro de contrato"
                  className="text-omega-400 hover:text-omega-700 p-0.5 rounded"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              onClick={() => setFiltroContrato('todos')}
              className={
                'w-full text-left px-2.5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-between gap-2 ' +
                (filtroContrato === 'todos'
                  ? 'bg-omega-900 text-white ring-1 ring-inset ring-omega-900/30'
                  : 'text-omega-700 hover:bg-omega-50')
              }
            >
              <span className="truncate text-[12px]">Todos os Contratos</span>
              <span className={
                'text-[11px] font-black tabular-nums px-1.5 py-0.5 rounded shrink-0 ' +
                (filtroContrato === 'todos' ? 'bg-white/20 text-white' : 'bg-omega-100 text-omega-600')
              }>
                {totalContratos}
              </span>
            </button>
            {contratos.map(c => {
              const ativo = filtroContrato === c.nome;
              return (
                <button
                  key={c.nome}
                  onClick={() => setFiltroContrato(ativo ? 'todos' : c.nome)}
                  title={c.nome}
                  className={
                    'w-full text-left px-2.5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-between gap-2 ' +
                    (ativo
                      ? 'bg-omega-900 text-white ring-1 ring-inset ring-omega-900/30 shadow-sm'
                      : 'text-omega-700 hover:bg-omega-50 border border-transparent')
                  }
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (ativo ? 'bg-white' : 'bg-omega-300')} />
                    <span className="truncate text-[12px]">{c.nome}</span>
                  </span>
                  <span className={
                    'text-[11px] font-black tabular-nums px-1.5 py-0.5 rounded shrink-0 ' +
                    (ativo ? 'bg-white/20 text-white' : 'bg-omega-100 text-omega-600')
                  }>
                    {c.total}
                  </span>
                </button>
              );
            })}
            {contratos.length === 0 && (
              <div className="px-2.5 py-2 text-[11px] text-omega-400">
                Nenhum contrato neste filtro.
              </div>
            )}
          </div>

          <div className="card p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Filter size={13} className="text-omega-500" />
              <span className="text-[11px] font-bold text-omega-700 uppercase tracking-wider">Filtros</span>
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-omega-400" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar TAG, placa..."
                className="input pl-8 !py-1.5 !text-xs"
              />
              {busca && (
                <button onClick={() => setBusca('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-omega-400 hover:text-omega-700 p-0.5">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 flex min-w-0 gap-0 card overflow-hidden">
          <div className={
            'flex-1 flex flex-col min-w-0 transition-all duration-200 ' +
            (temSelecionado ? 'border-r border-omega-200' : '')
          } style={{ maxWidth: temSelecionado ? 'calc(100% - 26rem)' : '100%' }}>
            <div className="px-4 py-2.5 border-b border-omega-100 bg-omega-50/70 flex items-center justify-between gap-3 shrink-0">
              <div className="text-[11px] font-semibold text-omega-600 flex items-center gap-2 min-w-0 flex-wrap">
                <span className="shrink-0">
                  {filtrados.length} veiculo{filtrados.length !== 1 ? 's' : ''} encontrado{filtrados.length !== 1 ? 's' : ''}
                  {filtroStatus !== 'todos' && ` • ${FILTROS_RAPIDOS.find(f => f.key === filtroStatus)?.label}`}
                  {filtroContrato !== 'todos' && ` • ${filtroContrato}`}
                </span>
                {filtroContrato !== 'todos' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-omega-900 text-white text-[10px] font-bold max-w-[220px]">
                    <Briefcase size={11} className="shrink-0" />
                    <span className="truncate">{filtroContrato}</span>
                    <button
                      onClick={() => setFiltroContrato('todos')}
                      title="Remover filtro de contrato"
                      className="hover:bg-white/20 rounded-full p-0.5"
                    >
                      <X size={11} />
                    </button>
                  </span>
                )}
              </div>
              <div className="text-[10px] text-omega-400">
                Clique na foto para ver detalhes
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {carregando ? (
                <div className="h-full flex items-center justify-center text-center text-omega-500 p-10">
                  <div>
                    <RefreshCw size={32} className="mx-auto text-omega-400 mb-3 animate-spin" />
                    <div className="font-semibold text-sm text-omega-700">Carregando frota da API...</div>
                  </div>
                </div>
              ) : erroApi ? (
                <div className="h-full flex items-center justify-center text-center p-10">
                  <div className="max-w-sm">
                    <AlertTriangle size={32} className="mx-auto text-status-amarelo mb-3" />
                    <div className="font-semibold text-sm text-omega-700 mb-1">Falha ao carregar a frota</div>
                    <div className="text-xs text-omega-500 mb-4">{erroApi}</div>
                    <button onClick={carregarVeiculos} className="btn-secondary !py-2 text-xs inline-flex items-center gap-1.5">
                      <RefreshCw size={14} /> Tentar novamente
                    </button>
                  </div>
                </div>
              ) : filtrados.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-omega-500 p-10">
                  <div>
                    <LayoutGrid size={42} className="mx-auto text-omega-300 mb-3" />
                    <div className="font-semibold text-sm text-omega-700 mb-1">
                      {listaVazia ? 'Nenhum veiculo cadastrado' : 'Nenhum veiculo encontrado'}
                    </div>
                    <div className="text-xs">
                      {listaVazia
                        ? 'Utilize o botao Adicionar para iniciar o cadastro da frota.'
                        : 'Ajuste os filtros ou realize uma nova busca.'}
                    </div>
                    {temFiltroAtivo && !listaVazia && (
                      <button onClick={limparFiltros} className="btn-secondary !py-1.5 text-xs mt-4 inline-flex items-center gap-1.5">
                        <X size={13} /> Limpar filtros
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
                  {filtrados.map(v => {
                    const selecionado = veiculoSelecionado?.tag === v.tag;
                    return (
                      <button
                        key={v.tag}
                        onClick={() => selecionarVeiculo(v)}
                        className={
                          'group text-left rounded-lg overflow-hidden bg-white border transition-all duration-150 focus:outline-none ' +
                          (selecionado
                            ? 'border-omega-accent ring-2 ring-omega-accent/30 shadow-md scale-[1.01]'
                            : 'border-omega-100 hover:border-omega-300 hover:shadow-md')
                        }
                      >
                        <div className="relative aspect-[4/3] bg-omega-100 overflow-hidden">
                          {v.foto_veiculo ? (
                            <img
                              src={v.foto_veiculo}
                              alt={`Foto ${v.tag}`}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : null}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                          <div className="absolute top-1.5 left-1.5">
                            <div className="px-1.5 py-0.5 bg-white/95 backdrop-blur rounded shadow-sm">
                              <div className="text-sm font-black text-omega-900 tracking-tight leading-none">{v.tag}</div>
                            </div>
                          </div>
                          <div className="absolute top-1.5 right-1.5">
                            <BadgeStatus status={v.status} dot={false} />
                          </div>
                          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-center">
                            <span className="px-2 py-0.5 bg-omega-900/85 backdrop-blur text-white rounded text-[10px] font-bold tracking-wide font-mono">
                              {v.placa}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {temSelecionado && (
            <div className="w-[26rem] shrink-0 min-w-0">
              <VehicleDetailPanel
                veiculo={veiculoSelecionado}
                onClose={() => setVeiculoSelecionado(null)}
                onEdit={() => abrirEdicao(veiculoSelecionado)}
                onDesmob={(v) => {
                  setModalDesmob(v || veiculoSelecionado);
                  setDataDesmob(new Date().toISOString().slice(0, 10));
                }}
              />
            </div>
          )}
        </div>
      </div>

      <Modal
        open={modalCadastro}
        onClose={() => { setModalCadastro(false); setErroCadastro(null); }}
        title="Cadastrar Novo Veiculo"
        subtitle="Preencha os dados do ativo para mobilizacao"
        footer={
          <>
            <button onClick={() => { setModalCadastro(false); setErroCadastro(null); }} className="btn-secondary">Cancelar</button>
            <button onClick={salvarNovo} className="btn-primary">Salvar e Mobilizar</button>
          </>
        }
      >
        {erroCadastro && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800">
            {erroCadastro}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">TAG <span className="text-status-vermelho">*</span></label>
            <input value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} className="input" placeholder="Ex: JI439" />
          </div>
          <div>
            <label className="label">Placa <span className="text-status-vermelho">*</span></label>
            <input value={form.placa} onChange={e => setForm({ ...form, placa: e.target.value })} className="input font-mono uppercase" placeholder="SZ10E93" />
          </div>
          <div className="md:col-span-2">
            <CampoListaComCriador
              id="cad-modelo"
              label="Modelo / Categoria"
              required
              value={form.modelo}
              onChange={e => setForm({ ...form, modelo: e.target.value })}
              opcoes={modelos}
              placeholderSelecionar="Selecione o modelo..."
              placeholderNovo="Digite o novo modelo (ex: Caminhão Munck)..."
            />
          </div>
          <div>
            <CampoListaComCriador
              id="cad-contrato"
              label="Contrato"
              value={form.contrato}
              onChange={e => setForm({ ...form, contrato: e.target.value })}
              opcoes={contratos.map((c) => c.nome)}
              placeholderSelecionar="Selecione o contrato..."
              placeholderNovo="Digite o novo contrato..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="input">
                <option>Mobilizado</option>
                <option>Desmobilizado</option>
              </select>
            </div>
            <div>
              <label className="label">Data MOB</label>
              <input type="date" value={form.data_mob} onChange={e => setForm({ ...form, data_mob: e.target.value })} className="input" />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!modalDesmob}
        onClose={() => { if (!desmobilizando) { setModalDesmob(null); setMotivoDesmob(''); } }}
        title="Desmobilizar Veículo"
        subtitle={modalDesmob ? (modalDesmob.tag + ' • ' + modalDesmob.modelo + ' • ' + modalDesmob.placa) : ''}
        size="sm"
        footer={
          <>
            <button onClick={() => { if (!desmobilizando) { setModalDesmob(null); setMotivoDesmob(''); } }} disabled={desmobilizando} className="btn-secondary disabled:opacity-50">Cancelar</button>
            <button onClick={confirmarDesmob} disabled={desmobilizando} className="btn-danger disabled:opacity-50 inline-flex items-center gap-2">
              {desmobilizando && <Loader2 size={15} className="animate-spin" />}
              {desmobilizando ? 'Desmobilizando...' : 'Sim, desmobilizar e apagar documentos'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800">
            <span className="font-bold">
              Tem certeza que deseja desmobilizar este veículo{modalDesmob ? ` (TAG: ${modalDesmob.tag})` : ''}?
            </span>{' '}
            Toda a documentação e anexos vinculados a ele serão apagados do controle de vencimentos.
            O registro da desmobilização será mantido no histórico, mas o veículo não constará mais
            no controle de documentação.
          </div>
          <div>
            <label className="label">Data da Desmobilizacao</label>
            <input type="date" value={dataDesmob} onChange={e => setDataDesmob(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Motivo / Observacao</label>
            <textarea
              value={motivoDesmob}
              onChange={e => setMotivoDesmob(e.target.value)}
              className="input min-h-[88px]"
              placeholder="Troca de contrato, manutencao pesada, etc."
            />
          </div>
        </div>
      </Modal>

      <EditVehicleModal
        open={!!modalEdicao}
        veiculo={modalEdicao}
        contratos={contratos}
        modelos={modelos}
        onClose={() => setModalEdicao(null)}
        onSaved={aoSalvarEdicao}
      />

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-xl bg-omega-900 text-white shadow-2xl text-sm font-semibold">
          <CheckCircle2 size={17} className="text-status-verde shrink-0" />
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="ml-1 hover:bg-white/15 rounded-full p-0.5">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
