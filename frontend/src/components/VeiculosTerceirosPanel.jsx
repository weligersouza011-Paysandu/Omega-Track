import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ImagePlus, Loader2, Plus, Trash2, Truck, X } from 'lucide-react';
import Modal from './Modal.jsx';
import CampoListaComCriador from './CampoListaComCriador.jsx';
import { authHeaders } from '../utils/sessao.js';

// Veículos de empresas terceirizadas: cadastro simples, usado SOMENTE como
// opção alocável na Programação de Recursos (sem Parte Diária, telemetria,
// documentação ou desmobilização). Fica recolhido por padrão no rodapé da frota.

const formInicial = () => ({
  tag: '', tipo: '', empresa_terceira: '', placa: '', modelo: '', observacao: '', foto_url: '',
});

async function lerErro(resp, padrao) {
  const corpo = await resp.json().catch(() => ({}));
  return corpo.message || `${padrao} (API ${resp.status}).`;
}

export default function VeiculosTerceirosPanel({ sessao, tiposFrota = [], onToast }) {
  const [aberto, setAberto] = useState(false);
  const [veiculos, setVeiculos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modalCadastro, setModalCadastro] = useState(false);
  const [form, setForm] = useState(formInicial);
  const [erroCadastro, setErroCadastro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [excluir, setExcluir] = useState(null);
  const [excluindo, setExcluindo] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const resp = await fetch('/api/veiculos-terceiros', { headers: authHeaders(sessao) });
      if (!resp.ok) throw new Error(await lerErro(resp, 'Falha ao carregar'));
      const { data } = await resp.json();
      setVeiculos(Array.isArray(data) ? data : []);
    } catch (e) {
      setErro(e.message || 'Não foi possível carregar os veículos terceiros.');
    } finally {
      setCarregando(false);
    }
  };

  // Carrega já na montagem para o contador do gatilho ficar correto.
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mesmos tipos da frota + os já usados por terceiros (agrupamento na programação).
  const tipos = useMemo(
    () => [...new Set([...tiposFrota, ...veiculos.map((v) => v.tipo)].map((t) => String(t || '').trim()).filter(Boolean))],
    [tiposFrota, veiculos]
  );

  const fecharCadastro = () => {
    if (salvando || enviandoFoto) return;
    setModalCadastro(false);
    setErroCadastro('');
    setForm(formInicial());
  };

  const enviarFoto = async (arquivo) => {
    if (!arquivo) return;
    setEnviandoFoto(true);
    setErroCadastro('');
    try {
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      const { Authorization } = authHeaders(sessao);
      const resp = await fetch('/api/upload?pasta=mobilizacao', {
        method: 'POST',
        headers: Authorization ? { Authorization } : undefined,
        body: fd,
      });
      if (!resp.ok) throw new Error(await lerErro(resp, 'Falha no upload da foto'));
      const { data } = await resp.json();
      setForm((atual) => ({ ...atual, foto_url: data.url }));
    } catch (e) {
      setErroCadastro(e.message);
    } finally {
      setEnviandoFoto(false);
    }
  };

  const salvar = async () => {
    const faltando = [];
    if (!form.tag.trim()) faltando.push('TAG');
    if (!String(form.tipo || '').trim()) faltando.push('Tipo de Veículo');
    if (faltando.length) {
      setErroCadastro(`Preencha os campos obrigatórios: ${faltando.join(', ')}.`);
      return;
    }
    setSalvando(true);
    setErroCadastro('');
    try {
      const payload = {
        tag: form.tag.trim().toUpperCase(),
        tipo: String(form.tipo).trim(),
        empresa_terceira: form.empresa_terceira.trim() || null,
        placa: form.placa.trim().toUpperCase() || null,
        modelo: form.modelo.trim() || null,
        observacao: form.observacao.trim() || null,
        foto_url: form.foto_url || null,
      };
      const resp = await fetch('/api/veiculos-terceiros', {
        method: 'POST',
        headers: authHeaders(sessao),
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(await lerErro(resp, 'Falha ao cadastrar'));
      const { data } = await resp.json();
      setVeiculos((lista) => [...lista, data].sort((a, b) =>
        a.tipo.localeCompare(b.tipo, 'pt-BR') || a.tag.localeCompare(b.tag, 'pt-BR')));
      onToast?.(`${data.tag} cadastrado como veículo terceiro.`);
      setModalCadastro(false);
      setForm(formInicial());
    } catch (e) {
      setErroCadastro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluir || excluindo) return;
    setExcluindo(true);
    try {
      const resp = await fetch(`/api/veiculos-terceiros/${encodeURIComponent(excluir.id)}`, {
        method: 'DELETE',
        headers: authHeaders(sessao),
      });
      if (!resp.ok && resp.status !== 404) throw new Error(await lerErro(resp, 'Falha ao excluir'));
      setVeiculos((lista) => lista.filter((v) => v.id !== excluir.id));
      onToast?.(`${excluir.tag} excluído dos veículos terceiros.`);
      setExcluir(null);
    } catch (e) {
      onToast?.(e.message);
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <div className="card shrink-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="w-full flex items-center justify-between gap-3 px-4 py-2 text-left hover:bg-omega-50/70 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-omega-600">
          <Truck size={14} className="text-omega-400" />
          Veículos Terceiros (Apenas Programação)
          <span className="text-[11px] font-black tabular-nums px-1.5 py-0.5 rounded bg-omega-100 text-omega-600">
            {carregando ? '…' : veiculos.length}
          </span>
        </span>
        {aberto ? <ChevronDown size={16} className="text-omega-400" /> : <ChevronUp size={16} className="text-omega-400" />}
      </button>

      {aberto && (
        <div className="border-t border-omega-100">
          <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 bg-omega-50/50">
            <p className="text-[11px] text-omega-500">
              Disponíveis somente para alocação na Programação de Recursos. Não entram em Parte Diária, telemetria ou indicadores da frota própria.
            </p>
            <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => setModalCadastro(true)}>
              <Plus size={14} /> Adicionar Veículo Terceiro
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {carregando ? (
              <div className="p-6 flex items-center justify-center gap-2 text-xs text-omega-500">
                <Loader2 size={15} className="animate-spin" /> Carregando...
              </div>
            ) : erro ? (
              <div className="p-6 text-center text-xs text-red-700">
                {erro}{' '}
                <button type="button" onClick={carregar} className="font-semibold underline">Tentar novamente</button>
              </div>
            ) : veiculos.length === 0 ? (
              <div className="p-6 text-center text-xs text-omega-500">Nenhum veículo terceiro cadastrado.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wider text-omega-500">
                  <tr className="border-b border-omega-100">
                    <th className="text-left font-bold px-4 py-2">TAG</th>
                    <th className="text-left font-bold px-2 py-2">Tipo</th>
                    <th className="text-left font-bold px-2 py-2 hidden sm:table-cell">Empresa</th>
                    <th className="text-left font-bold px-2 py-2 hidden md:table-cell">Placa</th>
                    <th className="text-left font-bold px-2 py-2 hidden lg:table-cell">Modelo</th>
                    <th className="px-4 py-2 w-12" aria-label="Ações" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-omega-100">
                  {veiculos.map((v) => (
                    <tr key={v.id} className="hover:bg-omega-50/50">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          {v.foto_url ? (
                            <img src={v.foto_url} alt="" className="w-7 h-7 rounded object-cover bg-omega-100" loading="lazy" />
                          ) : (
                            <span className="w-7 h-7 rounded bg-omega-100 flex items-center justify-center text-omega-400"><Truck size={13} /></span>
                          )}
                          <span className="font-mono font-bold text-omega-900">{v.tag}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-omega-700">{v.tipo}</td>
                      <td className="px-2 py-2 text-omega-600 hidden sm:table-cell">{v.empresa_terceira || '—'}</td>
                      <td className="px-2 py-2 font-mono text-omega-600 hidden md:table-cell">{v.placa || '—'}</td>
                      <td className="px-2 py-2 text-omega-600 hidden lg:table-cell">{v.modelo || '—'}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setExcluir(v)}
                          title={`Excluir ${v.tag}`}
                          aria-label={`Excluir ${v.tag}`}
                          className="p-1.5 rounded text-omega-400 hover:text-status-vermelho hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <Modal
        open={modalCadastro}
        onClose={fecharCadastro}
        title="Adicionar Veículo Terceiro"
        subtitle="Disponível apenas para alocação na Programação de Recursos"
        footer={
          <>
            <button onClick={fecharCadastro} disabled={salvando || enviandoFoto} className="btn-secondary disabled:opacity-50">Cancelar</button>
            <button onClick={salvar} disabled={salvando || enviandoFoto} className="btn-primary disabled:opacity-50 inline-flex items-center gap-2">
              {salvando && <Loader2 size={15} className="animate-spin" />}
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </>
        }
      >
        {erroCadastro && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800">{erroCadastro}</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="ter-tag">TAG <span className="text-status-vermelho">*</span></label>
            <input id="ter-tag" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}
              className="input uppercase" placeholder="Ex: TER-01 ou placa" maxLength={50} required />
          </div>
          <CampoListaComCriador
            id="ter-tipo"
            label="Tipo de Veículo"
            required
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value })}
            opcoes={tipos}
            placeholderSelecionar="Selecione o tipo..."
            placeholderNovo="Digite o novo tipo (ex: Caminhão Munck)..."
          />
          <div>
            <label className="label" htmlFor="ter-empresa">Empresa terceira</label>
            <input id="ter-empresa" value={form.empresa_terceira} maxLength={255}
              onChange={(e) => setForm({ ...form, empresa_terceira: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="ter-placa">Placa</label>
            <input id="ter-placa" value={form.placa} maxLength={20}
              onChange={(e) => setForm({ ...form, placa: e.target.value })} className="input font-mono uppercase" />
          </div>
          <div>
            <label className="label" htmlFor="ter-modelo">Modelo</label>
            <input id="ter-modelo" value={form.modelo} maxLength={100}
              onChange={(e) => setForm({ ...form, modelo: e.target.value })} className="input" />
          </div>
          <div>
            <span className="label">Foto</span>
            {form.foto_url ? (
              <div className="flex items-center gap-2">
                <img src={form.foto_url} alt="Foto do veículo" className="h-10 w-14 rounded object-cover" />
                <button type="button" className="btn-secondary !py-1.5 text-xs"
                  onClick={() => setForm({ ...form, foto_url: '' })}>
                  <X size={13} /> Remover
                </button>
              </div>
            ) : (
              <label className={`btn-secondary !py-2 text-xs inline-flex items-center gap-1.5 cursor-pointer ${enviandoFoto ? 'opacity-50 pointer-events-none' : ''}`}>
                {enviandoFoto ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {enviandoFoto ? 'Enviando...' : 'Selecionar imagem'}
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => { enviarFoto(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="ter-obs">Observação</label>
            <textarea id="ter-obs" value={form.observacao} maxLength={2000}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })} className="input min-h-[64px]" />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!excluir}
        onClose={() => { if (!excluindo) setExcluir(null); }}
        title="Excluir Veículo Terceiro"
        subtitle={excluir ? `${excluir.tag} • ${excluir.tipo}` : ''}
        size="sm"
        footer={
          <>
            <button onClick={() => setExcluir(null)} disabled={excluindo} className="btn-secondary disabled:opacity-50">Cancelar</button>
            <button onClick={confirmarExclusao} disabled={excluindo} className="btn-danger disabled:opacity-50 inline-flex items-center gap-2">
              {excluindo ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              {excluindo ? 'Excluindo...' : 'Excluir'}
            </button>
          </>
        }
      >
        <p className="text-sm text-omega-700">
          Excluir <span className="font-bold">{excluir?.tag}</span>? O veículo sai da Programação de Recursos,
          junto com as alocações registradas para ele. Esta ação não pode ser desfeita.
        </p>
      </Modal>
    </div>
  );
}
