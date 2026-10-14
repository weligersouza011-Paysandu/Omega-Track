import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, Pencil, Trash2, X, RefreshCw, AlertTriangle,
  CheckCircle2, Building2, Power,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import StatCard from '../components/StatCard.jsx';
import { authHeaders } from '../utils/sessao.js';
import { podeEscrever } from '../utils/permissoes.js';

function formVazio() {
  return {
    nome: '',
    numeroContrato: '4800001236',
    contratante: 'Vale',
    gestao: 'Denilson Silva',
    planejador: '',
    ativo: true,
  };
}

export default function ObrasView({ sessao }) {
  const usuario = sessao?.usuario || null;
  const podeGerenciar = podeEscrever(usuario, 'obras');

  const [obras, setObras] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState('todas'); // todas | ativas | inativas

  const [modal, setModal] = useState(null); // { modo: 'novo'|'editar', id?, form }
  const [excluir, setExcluir] = useState(null); // obra alvo da confirmacao
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch('/api/obras?limit=200', { headers: authHeaders(sessao) });
      if (!resp.ok) throw new Error(`API respondeu ${resp.status}`);
      const corpo = await resp.json();
      setObras(Array.isArray(corpo?.data) ? corpo.data : []);
    } catch {
      setErro('Não foi possível carregar as obras. Verifique se o backend está no ar.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visiveis = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return obras.filter((o) => {
      if (filtroAtivo === 'ativas' && !o.ativo) return false;
      if (filtroAtivo === 'inativas' && o.ativo) return false;
      if (!q) return true;
      return [o.nome, o.numeroContrato, o.contratante, o.gestao, o.planejador]
        .some((v) => String(v || '').toUpperCase().includes(q));
    });
  }, [obras, busca, filtroAtivo]);

  const kpis = useMemo(() => ({
    total: obras.length,
    ativas: obras.filter((o) => o.ativo).length,
    inativas: obras.filter((o) => !o.ativo).length,
  }), [obras]);

  // Autocomplete do Planejador: nomes únicos já cadastrados (digitação livre continua permitida;
  // um novo nome salvo passa a integrar as sugestões automaticamente no próximo carregamento).
  const planejadoresSugeridos = useMemo(
    () => Array.from(new Set(
      obras.map((o) => String(o.planejador || '').trim()).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [obras]
  );

  const abrirNovo = () => {
    setErroForm(null);
    setModal({ modo: 'novo', id: null, form: formVazio() });
  };

  const abrirEdicao = (o) => {
    setErroForm(null);
    setModal({
      modo: 'editar',
      id: o.id,
      form: {
        nome: o.nome || '',
        numeroContrato: o.numeroContrato || '',
        contratante: o.contratante || 'Vale',
        gestao: o.gestao || '',
        planejador: o.planejador || '',
        ativo: o.ativo !== false,
      },
    });
  };

  const salvar = async () => {
    if (!modal) return;
    const f = modal.form;
    if (!String(f.nome || '').trim()) {
      setErroForm('Nome da Obra é obrigatório.');
      return;
    }
    setErroForm(null);
    setSalvando(true);
    try {
      const payload = {
        nome: String(f.nome).trim(),
        numeroContrato: String(f.numeroContrato || '').trim() || null,
        contratante: String(f.contratante || '').trim() || 'Vale',
        gestao: String(f.gestao || '').trim() || null,
        planejador: String(f.planejador || '').trim() || null,
        ativo: !!f.ativo,
      };
      const url = modal.modo === 'novo' ? '/api/obras' : `/api/obras/${modal.id}`;
      const resp = await fetch(url, {
        method: modal.modo === 'novo' ? 'POST' : 'PUT',
        headers: authHeaders(sessao),
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.message || `Falha ao salvar (API ${resp.status})`);
      }
      setModal(null);
      setToast(modal.modo === 'novo' ? 'Obra cadastrada com sucesso!' : 'Obra atualizada!');
      carregar();
    } catch (e) {
      setErroForm(e.message || 'Falha ao salvar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExcluir = async () => {
    if (!excluir) return;
    setSalvando(true);
    try {
      const resp = await fetch(`/api/obras/${excluir.id}`, {
        method: 'DELETE',
        headers: authHeaders(sessao),
      });
      if (!resp.ok && resp.status !== 204) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.message || `Falha ao excluir (API ${resp.status})`);
      }
      setExcluir(null);
      setToast(`Obra "${excluir.nome}" excluída.`);
      carregar();
    } catch (e) {
      setToast(null);
      setErro(e.message || 'Falha ao excluir.');
    } finally {
      setSalvando(false);
    }
  };

  const temFiltro = busca.trim() !== '' || filtroAtivo !== 'todas';

  return (
    <div className="space-y-5">
      {/* Cabeçalho + ação */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Transporte</div>
          <h1 className="mt-0.5 text-xl font-extrabold text-omega-900 tracking-tight sm:text-2xl">
            Obras
          </h1>
          <p className="mt-1 text-sm text-omega-500">
            Cadastro de obras para seleção nos relatórios de Parte Diária.
            {!podeGerenciar && ' Você tem acesso de leitura.'}
          </p>
        </div>
        {podeGerenciar && (
          <button onClick={abrirNovo} className="btn-primary !py-2 text-sm shrink-0">
            <Plus size={16} /> Adicionar Obra
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Total" value={kpis.total} sub="Obras cadastradas" icon={Building2} iconBg="bg-omega-900" />
        <StatCard title="Ativas" value={kpis.ativas} sub="Disponíveis na Parte Diária" icon={CheckCircle2} iconBg="bg-status-verde" />
        <StatCard title="Inativas" value={kpis.inativas} sub="Fora do dropdown" icon={Power} iconBg="bg-omega-400" />
      </div>

      {/* Filtros */}
      <div className="card p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="input pl-9"
            placeholder="Buscar nome, contrato, contratante, responsável..."
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={filtroAtivo} onChange={(e) => setFiltroAtivo(e.target.value)} className="input !w-auto">
            <option value="todas">Todas</option>
            <option value="ativas">Ativas</option>
            <option value="inativas">Inativas</option>
          </select>
          {temFiltro && (
            <button onClick={() => { setBusca(''); setFiltroAtivo('todas'); }} className="btn-secondary !py-2 text-xs">
              <X size={14} /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-omega-100 bg-omega-50/50 flex items-center gap-2">
          <Building2 size={14} className="text-omega-500" />
          <span className="text-sm font-bold text-omega-900">Obras cadastradas</span>
          <span className="text-[11px] text-omega-500 ml-auto">{visiveis.length} registro(s)</span>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center p-10 text-omega-500 text-sm font-semibold">
            <RefreshCw size={20} className="animate-spin mr-2" /> Carregando obras...
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
            <Building2 size={36} className="mx-auto text-omega-300 mb-3" />
            <div className="text-sm font-semibold text-omega-700 mb-1">
              {temFiltro ? 'Nenhuma obra neste filtro' : 'Nenhuma obra cadastrada'}
            </div>
            <div className="text-xs mb-4">
              {temFiltro ? 'Ajuste os filtros ou limpe a busca.' : 'Cadastre a primeira obra para alimentar a Parte Diária.'}
            </div>
            {podeGerenciar && !temFiltro && (
              <button onClick={abrirNovo} className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5">
                <Plus size={14} /> Adicionar Obra
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-omega-50/70">
                <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-bold border-b border-omega-100">
                  <th className="px-4 py-3">Nome da Obra</th>
                  <th className="px-4 py-3">Nº do Contrato</th>
                  <th className="px-4 py-3">Contratante</th>
                  <th className="px-4 py-3">Gestão</th>
                  <th className="px-4 py-3">Planejador</th>
                  <th className="px-4 py-3">Status</th>
                  {podeGerenciar && <th className="px-4 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-omega-100">
                {visiveis.map((o) => (
                  <tr key={o.id} className="hover:bg-omega-50/60">
                    <td className="px-4 py-2.5 font-bold text-omega-900">{o.nome}</td>
                    <td className="px-4 py-2.5 font-mono text-omega-700">{o.numeroContrato || '—'}</td>
                    <td className="px-4 py-2.5 text-omega-700">{o.contratante || '—'}</td>
                    <td className="px-4 py-2.5 text-omega-700">{o.gestao || '—'}</td>
                    <td className="px-4 py-2.5 text-omega-700">{o.planejador || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`chip ${o.ativo ? 'bg-green-50 text-status-verde ring-1 ring-inset ring-green-600/20' : 'bg-omega-100 text-omega-500 ring-1 ring-inset ring-omega-700/10'}`}>
                        {o.ativo ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    {podeGerenciar && (
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => abrirEdicao(o)} title="Editar" className="p-1.5 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 transition-colors">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => setExcluir(o)} title="Excluir" className="p-1.5 rounded-md hover:bg-red-50 text-omega-400 hover:text-status-vermelho transition-colors">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal cadastro/edição */}
      <Modal
        open={!!modal}
        onClose={() => { if (!salvando) setModal(null); }}
        title={modal?.modo === 'editar' ? `Editar Obra • ${modal?.form?.nome}` : 'Adicionar Obra'}
        subtitle="Dados usados no preenchimento automático da Parte Diária"
        size="md"
        footer={
          <>
            <button onClick={() => setModal(null)} disabled={salvando} className="btn-secondary disabled:opacity-50">Cancelar</button>
            <button onClick={salvar} disabled={salvando} className="btn-primary disabled:opacity-50">
              {salvando ? 'Salvando...' : modal?.modo === 'editar' ? 'Salvar alterações' : 'Cadastrar Obra'}
            </button>
          </>
        }
      >
        {modal && (
          <div className="space-y-3">
            {erroForm && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800">{erroForm}</div>
            )}
            <div>
              <label className="label">Nome da Obra <span className="text-status-vermelho">*</span></label>
              <input
                value={modal.form.nome}
                onChange={(e) => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })}
                className="input"
                placeholder="Ex: 998 - CEP Centro de Empresas Parceiras"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Nº do Contrato</label>
                <input
                  value={modal.form.numeroContrato}
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, numeroContrato: e.target.value } })}
                  className="input font-mono"
                  placeholder="Ex: 4800001236"
                />
              </div>
              <div>
                <label className="label">Contratante</label>
                <input
                  value={modal.form.contratante}
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, contratante: e.target.value } })}
                  className="input"
                  placeholder="Vale"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Gestão</label>
                <input
                  value={modal.form.gestao}
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, gestao: e.target.value } })}
                  className="input"
                  placeholder="Ex: Denilson Silva"
                />
              </div>
              <div>
                <label className="label">Planejador</label>
                <input
                  value={modal.form.planejador}
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, planejador: e.target.value } })}
                  className="input"
                  placeholder="Digite ou escolha um planejador"
                  list="obras-planejadores"
                  autoComplete="off"
                />
                <datalist id="obras-planejadores">
                  {planejadoresSugeridos.map((nome) => (
                    <option key={nome} value={nome} />
                  ))}
                </datalist>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-omega-700 cursor-pointer">
              <input
                type="checkbox"
                checked={modal.form.ativo}
                onChange={(e) => setModal({ ...modal, form: { ...modal.form, ativo: e.target.checked } })}
                className="w-4 h-4 accent-omega-900"
              />
              Obra ativa (aparece no dropdown da Parte Diária)
            </label>
          </div>
        )}
      </Modal>

      {/* Confirmar exclusão */}
      <Modal
        open={!!excluir}
        onClose={() => { if (!salvando) setExcluir(null); }}
        title="Excluir obra"
        subtitle={excluir ? `Remover "${excluir.nome}" do cadastro?` : ''}
        size="sm"
        footer={
          <>
            <button onClick={() => setExcluir(null)} disabled={salvando} className="btn-secondary disabled:opacity-50">Cancelar</button>
            <button onClick={confirmarExcluir} disabled={salvando} className="btn-danger disabled:opacity-50">
              {salvando ? 'Excluindo...' : 'Excluir'}
            </button>
          </>
        }
      >
        <p className="text-sm text-omega-600">
          As Partes Diárias já lançadas mantêm o nome da obra em texto; apenas o vínculo é desfeito.
          {excluir?.totalPartes ? (
            <> Esta obra possui <strong>{excluir.totalPartes} parte(s) diária(s)</strong> vinculada(s).</>
          ) : null}
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
    </div>
  );
}
