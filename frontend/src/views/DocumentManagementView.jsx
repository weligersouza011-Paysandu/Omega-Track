import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, X, Pencil, Trash2, FileText, ExternalLink,
  RefreshCw, AlertTriangle, ImagePlus, Loader2, CheckCircle2, Filter,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import CampoListaComCriador from '../components/CampoListaComCriador.jsx';
import { calcularFarol, textoDias, FAROL_LABEL_CURTO, FAROL_COR, ORDEM_FAROL } from '../utils/farol.js';

const TIPOS_PADRAO = ['CRLV', 'LAUDO', 'INSPEÇÃO', 'SEGURO', 'CNH', 'TACÓGRAFO'];

function paraInputDate(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function formatarData(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function ehPdf(url) {
  return /\.pdf(\?|#|$)/i.test(String(url || ''));
}

function FarolBadge({ farol }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-bold whitespace-nowrap"
      style={{ background: `${FAROL_COR[farol]}15`, color: FAROL_COR[farol] }}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: FAROL_COR[farol] }} />
      {FAROL_LABEL_CURTO[farol]}
    </span>
  );
}

export default function DocumentManagementView({ veiculos = [] }) {
  const [docs, setDocs] = useState([]);
  const [frota, setFrota] = useState(veiculos);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroFarol, setFiltroFarol] = useState('todos');
  const [modal, setModal] = useState(null); // { modo: 'novo' } | { modo: 'editar', doc }
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [rDocs, rFrota] = await Promise.all([
        fetch('/api/documentacao-veiculos?limit=200').then((r) => {
          if (!r.ok) throw new Error(`Documentos: API ${r.status}`);
          return r.json();
        }),
        veiculos.length > 0
          ? Promise.resolve(null)
          : fetch('/api/mob-desmob?limit=200').then((r) => (r.ok ? r.json() : null)),
      ]);
      setDocs(Array.isArray(rDocs.data) ? rDocs.data : []);
      if (rFrota && Array.isArray(rFrota.data)) setFrota(rFrota.data);
      else if (veiculos.length > 0) setFrota(veiculos);
    } catch (e) {
      setErro('Não foi possível carregar a documentação. Verifique se o backend está no ar.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (veiculos.length > 0) setFrota(veiculos);
  }, [veiculos]);

  const placaPorTag = useMemo(() => {
    const m = new Map();
    frota.forEach((v) => m.set(v.tag, v.placa));
    return m;
  }, [frota]);

  const docsComFarol = useMemo(
    () => docs.map((d) => ({ ...d, ...calcularFarol(d.validade) })),
    [docs]
  );

  const tipos = useMemo(() => {
    const s = new Set(TIPOS_PADRAO);
    docs.forEach((d) => {
      const t = String(d.documento || '').trim().toUpperCase();
      if (t) s.add(t);
    });
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [docs]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return docsComFarol.filter((d) => {
      if (filtroTipo !== 'todos' && String(d.documento || '').trim().toUpperCase() !== filtroTipo) return false;
      if (filtroFarol !== 'todos' && d.farol !== filtroFarol) return false;
      if (!q) return true;
      const placa = placaPorTag.get(d.tag) || d.veiculo?.placa || '';
      return (d.tag || '').toUpperCase().includes(q) || placa.toUpperCase().includes(q);
    });
  }, [docsComFarol, busca, filtroTipo, filtroFarol, placaPorTag]);

  const temFiltro = busca.trim() !== '' || filtroTipo !== 'todos' || filtroFarol !== 'todos';

  const excluir = async (doc) => {
    if (!window.confirm(`Excluir ${doc.documento} de ${doc.tag}?`)) return;
    try {
      const resp = await fetch(`/api/documentacao-veiculos/${doc.id}`, { method: 'DELETE' });
      if (!resp.ok && resp.status !== 204) throw new Error(`API ${resp.status}`);
      setToast('Documento excluído.');
      carregar();
    } catch (e) {
      setToast(`Falha ao excluir: ${e.message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Gestão documental da frota</div>
          <h1 className="mt-0.5 text-xl font-extrabold text-omega-900 tracking-tight sm:text-2xl">
            Controle de Documentação
          </h1>
          <div className="text-[11px] text-omega-500 mt-0.5">
            {docs.length} documento(s) • {filtrados.length} exibido(s)
          </div>
        </div>
        <button onClick={() => setModal({ modo: 'novo' })} className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5">
          <Plus size={14} /> Adicionar Documento
        </button>
      </div>

      <div className="card p-3 flex flex-col md:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-omega-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por TAG ou placa..."
            className="input pl-8 !py-1.5 !text-xs"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-omega-400 hover:text-omega-700 p-0.5">
              <X size={12} />
            </button>
          )}
        </div>
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="input !py-1.5 !text-xs md:w-48" title="Tipo de documento">
          <option value="todos">Todos os tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filtroFarol} onChange={(e) => setFiltroFarol(e.target.value)} className="input !py-1.5 !text-xs md:w-48" title="Status do farol">
          <option value="todos">Todos os faróis</option>
          {ORDEM_FAROL.map((f) => <option key={f} value={f}>{FAROL_LABEL_CURTO[f]}</option>)}
        </select>
        {temFiltro && (
          <button
            onClick={() => { setBusca(''); setFiltroTipo('todos'); setFiltroFarol('todos'); }}
            className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1"
          >
            <X size={13} /> Limpar
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {carregando ? (
          <div className="flex items-center justify-center p-10 text-omega-500">
            <RefreshCw size={28} className="animate-spin mr-2 text-omega-400" />
            <span className="text-sm font-semibold">Carregando documentação...</span>
          </div>
        ) : erro ? (
          <div className="flex flex-col items-center p-10 text-center">
            <AlertTriangle size={28} className="text-status-amarelo mb-2" />
            <div className="text-sm font-semibold text-omega-700">{erro}</div>
            <button onClick={carregar} className="btn-secondary !py-2 text-xs mt-4 inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Tentar novamente
            </button>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="p-10 text-center text-sm text-omega-500">
            <Filter size={28} className="mx-auto text-omega-300 mb-2" />
            <div className="font-semibold text-omega-700">Nenhum documento encontrado</div>
            <div className="text-xs mt-1">Ajuste os filtros ou cadastre o primeiro documento da frota.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[880px]">
              <thead className="bg-omega-50/70">
                <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-bold border-b border-omega-100">
                  <th className="px-4 py-3">Veículo (TAG / Placa)</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Vencimento</th>
                  <th className="px-4 py-3">Dias</th>
                  <th className="px-4 py-3">Farol</th>
                  <th className="px-4 py-3">Anexo</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-omega-100">
                {filtrados.map((d) => {
                  const placa = placaPorTag.get(d.tag) || d.veiculo?.placa || '—';
                  return (
                    <tr key={d.id} className="hover:bg-omega-50/60">
                      <td className="px-4 py-2.5">
                        <span className="font-bold text-omega-900">{d.tag}</span>
                        <span className="text-omega-500 font-mono text-xs ml-1.5">({placa})</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-semibold text-omega-700">{d.documento}</td>
                      <td className="px-4 py-2.5 tabular-nums text-xs text-omega-700">{formatarData(d.validade)}</td>
                      <td className="px-4 py-2.5 text-xs text-omega-600 whitespace-nowrap" title={textoDias(d.dias)}>
                        {textoDias(d.dias)}
                      </td>
                      <td className="px-4 py-2.5"><FarolBadge farol={d.farol} /></td>
                      <td className="px-4 py-2.5">
                        {d.anexo_url ? (
                          <a
                            href={d.anexo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Abrir anexo no Cloudinary"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-omega-accent hover:underline"
                          >
                            {ehPdf(d.anexo_url) ? <FileText size={15} /> : <ImagePlus size={15} />}
                            {ehPdf(d.anexo_url) ? 'PDF' : 'Imagem'}
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="text-[11px] text-omega-400">Sem anexo</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setModal({ modo: 'editar', doc: d })}
                            title="Editar documento"
                            className="p-1.5 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 transition-colors"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => excluir(d)}
                            title="Excluir documento"
                            className="p-1.5 rounded-md hover:bg-red-50 text-omega-400 hover:text-red-700 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DocModal
        key={modal ? `${modal.modo}-${modal.doc?.id || 'novo'}` : 'fechado'}
        modal={modal}
        frota={frota}
        tipos={tipos}
        onClose={() => setModal(null)}
        onSaved={(msg) => { setModal(null); setToast(msg); carregar(); }}
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

function DocModal({ modal, frota, tipos, onClose, onSaved }) {
  const aberto = !!modal;
  const doc = modal?.doc;
  const [form, setForm] = useState({
    tag: doc?.tag || '',
    documento: doc ? String(doc.documento || '').trim().toUpperCase() : '',
    validade: paraInputDate(doc?.validade),
  });
  const [arquivo, setArquivo] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  if (!aberto) return null;

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const salvar = async () => {
    if (!form.tag) { setErro('Selecione o veículo (TAG).'); return; }
    if (!String(form.documento || '').trim()) { setErro('Tipo do documento é obrigatório.'); return; }
    if (!form.validade) { setErro('Data de vencimento é obrigatória.'); return; }
    setSalvando(true);
    setErro(null);
    try {
      let id = doc?.id;
      if (modal.modo === 'novo') {
        const resp = await fetch('/api/documentacao-veiculos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tag: form.tag,
            documento: String(form.documento).trim().toUpperCase(),
            validade: form.validade,
          }),
        });
        if (!resp.ok) {
          const corpo = await resp.json().catch(() => ({}));
          throw new Error(corpo.message || `API respondeu ${resp.status}`);
        }
        id = (await resp.json()).data.id;
      } else {
        const resp = await fetch(`/api/documentacao-veiculos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documento: String(form.documento).trim().toUpperCase(),
            validade: form.validade,
          }),
        });
        if (!resp.ok) {
          const corpo = await resp.json().catch(() => ({}));
          throw new Error(corpo.message || `API respondeu ${resp.status}`);
        }
      }
      if (arquivo) {
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        const rAnexo = await fetch(`/api/documentacao-veiculos/${id}/anexo`, { method: 'POST', body: fd });
        if (!rAnexo.ok) {
          const corpo = await rAnexo.json().catch(() => ({}));
          throw new Error(corpo.message || `Falha no upload do anexo (${rAnexo.status})`);
        }
      }
      onSaved(modal.modo === 'novo' ? 'Documento cadastrado com sucesso!' : 'Documento atualizado com sucesso!');
    } catch (e) {
      setErro(e.message || 'Falha ao salvar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={modal.modo === 'novo' ? 'Adicionar Documento' : `Editar Documento • ${doc.tag}`}
      subtitle="Anexo sobe para omegatrack/documentos e a URL é salva no Neon"
      footer={
        <>
          <button onClick={onClose} disabled={salvando} className="btn-secondary">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="btn-primary inline-flex items-center gap-2">
            {salvando && <Loader2 size={15} className="animate-spin" />}
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {erro && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200/60 text-sm text-red-800">{erro}</div>
        )}
        <div>
          <label className="label">Veículo (TAG / Placa) <span className="text-status-vermelho">*</span></label>
          <select value={form.tag} onChange={set('tag')} disabled={modal.modo === 'editar'} className="input">
            <option value="">Selecione o veículo...</option>
            {frota.map((v) => (
              <option key={v.tag} value={v.tag}>{v.tag} ({v.placa})</option>
            ))}
          </select>
        </div>
        <div>
          <CampoListaComCriador
            id="doc-tipo"
            label="Tipo do Documento"
            required
            value={form.documento}
            onChange={set('documento')}
            opcoes={tipos}
            placeholderSelecionar="Selecione o tipo..."
            placeholderNovo="Digite o novo tipo (ex: TACÓGRAFO)..."
          />
        </div>
        <div>
          <label className="label">Data de Vencimento <span className="text-status-vermelho">*</span></label>
          <input type="date" value={form.validade} onChange={set('validade')} className="input" />
        </div>
        <div>
          <div className="label">Anexo (PDF ou imagem, máx. 5 MB)</div>
          {doc?.anexo_url && !arquivo && (
            <a href={doc.anexo_url} target="_blank" rel="noopener noreferrer" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-omega-accent hover:underline">
              {ehPdf(doc.anexo_url) ? <FileText size={14} /> : <ImagePlus size={14} />} Anexo atual <ExternalLink size={11} />
            </a>
          )}
          <label className="cursor-pointer rounded-xl border border-dashed border-omega-200 hover:border-omega-400 bg-omega-50/50 px-3 py-3 flex items-center gap-2 text-xs text-omega-600 transition-colors">
            <ImagePlus size={16} className="text-omega-500 shrink-0" />
            <span className="font-bold text-omega-800">{arquivo ? arquivo.name : 'Selecionar arquivo...'}</span>
            <input
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={(e) => setArquivo(e.target.files?.[0] || null)}
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
