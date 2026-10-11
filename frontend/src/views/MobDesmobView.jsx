import { useMemo, useState } from 'react';
import { Plus, Search, Filter, Download, X, LayoutGrid, BarChart3, CheckCircle2 } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import BadgeStatus from '../components/BadgeStatus.jsx';
import VehicleDetailPanel from '../components/VehicleDetailPanel.jsx';
import DashboardExecutivoView from './DashboardExecutivoView.jsx';
import { veiculos as initialVeiculos } from '../data/mockData.js';

const FILTROS_RAPIDOS = [
  { key: 'todos', label: 'Todos', icon: null, cor: null },
  { key: 'Mobilizado', label: 'Mobilizado (Ativo)', icon: CheckCircle2, cor: 'status-verde' },
  { key: 'Desmobilizado', label: 'Desmobilizado (Desativado)', icon: X, cor: 'status-vermelho' },
];

const ABAS = [
  { key: 'galeria', label: 'Galeria de Veiculos', icon: LayoutGrid },
  { key: 'dashboard', label: 'Dashboard Executivo (CT251)', icon: BarChart3 },
];

export default function MobDesmobView() {
  const [veiculos, setVeiculos] = useState(initialVeiculos);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('Mobilizado');
  const [abaAtiva, setAbaAtiva] = useState('galeria');
  const [veiculoSelecionado, setVeiculoSelecionado] = useState(null);
  const [modalCadastro, setModalCadastro] = useState(false);
  const [modalDesmob, setModalDesmob] = useState(null);
  const [form, setForm] = useState({ tag: '', placa: '', modelo: '', contrato: '', status: 'Mobilizado', data_mob: new Date().toISOString().slice(0, 10) });
  const [dataDesmob, setDataDesmob] = useState(new Date().toISOString().slice(0, 10));

  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return veiculos.filter(v => {
      if (filtroStatus !== 'todos' && v.status !== filtroStatus) return false;
      if (!q) return true;
      return (
        v.tag.toUpperCase().includes(q) ||
        v.placa.toUpperCase().includes(q) ||
        v.modelo.toUpperCase().includes(q) ||
        (v.contrato || '').toUpperCase().includes(q)
      );
    });
  }, [veiculos, busca, filtroStatus]);

  const contagem = useMemo(() => {
    return {
      todos: veiculos.length,
      Mobilizado: veiculos.filter(v => v.status === 'Mobilizado').length,
      Desmobilizado: veiculos.filter(v => v.status === 'Desmobilizado').length,
    };
  }, [veiculos]);

  const salvarNovo = () => {
    if (!form.tag || !form.placa) return;
    const novo = {
      ...form,
      placa: form.placa.toUpperCase(),
      foto_veiculo: 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=white%20mitsubishi%20l200%20pickup%20truck%20front%20view%20ji%20red%20decal%20hood%20mining&image_size=landscape_4_3',
      data_desmob: null,
      categoria: form.modelo,
    };
    setVeiculos([novo, ...veiculos]);
    setModalCadastro(false);
    setForm({ tag: '', placa: '', modelo: '', contrato: '', status: 'Mobilizado', data_mob: new Date().toISOString().slice(0, 10) });
  };

  const confirmarDesmob = () => {
    if (!modalDesmob) return;
    setVeiculos(veiculos.map(v =>
      v.tag === modalDesmob.tag ? { ...v, status: 'Desmobilizado', data_desmob: dataDesmob } : v
    ));
    setModalDesmob(null);
  };

  const selecionarVeiculo = (v) => {
    setVeiculoSelecionado(v);
  };

  const listaVazia = veiculos.length === 0;

  if (abaAtiva === 'dashboard') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2 border-b border-omega-200 pb-0.5">
          {ABAS.map(aba => {
            const ativo = abaAtiva === aba.key;
            return (
              <button
                key={aba.key}
                onClick={() => setAbaAtiva(aba.key)}
                className={
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-t-lg transition-all -mb-px ' +
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
        <DashboardExecutivoView />
      </div>
    );
  }

  const temSelecionado = !!veiculoSelecionado;

  return (
    <div className="space-y-4 h-[calc(100vh-10rem)] min-h-[600px] flex flex-col">
      <div className="flex items-center gap-2 border-b border-omega-200 pb-0.5 shrink-0">
        {ABAS.map(aba => {
          const ativo = abaAtiva === aba.key;
          return (
            <button
              key={aba.key}
              onClick={() => setAbaAtiva(aba.key)}
              className={
                'flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-t-lg transition-all -mb-px ' +
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

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 shrink-0">
        <div>
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Controle de MOB e DESMOB</div>
          <h1 className="mt-0.5 text-xl font-extrabold text-omega-900 tracking-tight sm:text-2xl">
            Frota — Mobilizacao & Desmobilizacao
          </h1>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary !py-2 text-xs"><Download size={14} /> Exportar</button>
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
            <div className="px-4 py-2.5 border-b border-omega-100 bg-omega-50/70 flex items-center justify-between shrink-0">
              <div className="text-[11px] font-semibold text-omega-600">
                {filtrados.length} veiculo{filtrados.length !== 1 ? 's' : ''} encontrado{filtrados.length !== 1 ? 's' : ''}
                {filtroStatus !== 'todos' && ` • ${FILTROS_RAPIDOS.find(f => f.key === filtroStatus)?.label}`}
              </div>
              <div className="text-[10px] text-omega-400">
                Clique na foto para ver detalhes
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {filtrados.length === 0 ? (
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
                          <img
                            src={v.foto_veiculo}
                            alt={`Foto ${v.tag}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
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
                onEdit={() => {}}
              />
            </div>
          )}
        </div>
      </div>

      <Modal
        open={modalCadastro}
        onClose={() => setModalCadastro(false)}
        title="Cadastrar Novo Veiculo"
        subtitle="Preencha os dados do ativo para mobilizacao"
        footer={
          <>
            <button onClick={() => setModalCadastro(false)} className="btn-secondary">Cancelar</button>
            <button onClick={salvarNovo} className="btn-primary">Salvar e Mobilizar</button>
          </>
        }
      >
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
            <label className="label">Modelo / Categoria</label>
            <input value={form.modelo} onChange={e => setForm({ ...form, modelo: e.target.value })} className="input" placeholder="Caminhonete, Onibus, Caminhao Munck..." />
          </div>
          <div>
            <label className="label">Contrato</label>
            <input value={form.contrato} onChange={e => setForm({ ...form, contrato: e.target.value })} className="input" placeholder="Eletromecanica, Serra Leste..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="input">
                <option>Mobilizado</option>
                <option>Desmobilizado</option>
                <option>Em Manutencao</option>
                <option>Interditado</option>
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
        onClose={() => setModalDesmob(null)}
        title="Registrar Desmobilizacao"
        subtitle={modalDesmob ? (modalDesmob.tag + ' • ' + modalDesmob.modelo + ' • ' + modalDesmob.placa) : ''}
        size="sm"
        footer={
          <>
            <button onClick={() => setModalDesmob(null)} className="btn-secondary">Cancelar</button>
            <button onClick={confirmarDesmob} className="btn-danger">Confirmar DESMOB</button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800">
            A desmobilizacao altera o status do veiculo e registra a data de saida da operacao.
          </div>
          <div>
            <label className="label">Data da Desmobilizacao</label>
            <input type="date" value={dataDesmob} onChange={e => setDataDesmob(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Motivo / Observacao</label>
            <textarea className="input min-h-[88px]" placeholder="Troca de contrato, manutencao pesada, etc." />
          </div>
        </div>
      </Modal>
    </div>
  );
}
