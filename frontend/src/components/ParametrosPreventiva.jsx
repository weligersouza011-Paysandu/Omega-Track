import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, AlertTriangle, Settings2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { lerSessao, authHeaders } from '../utils/sessao.js';
import { podeEscrever } from '../utils/permissoes.js';

// ============================================================================
// Aba "Parâmetros de Preventiva" (Mobilização & Frota): CRUD dos limites de
// km por categoria de veículo (modelo) e contrato. Escrita: Gestão/Transporte
// ou ADM Master (reforçado no backend); demais perfis visualizam.
// ============================================================================

const MODAL_VAZIO = { categoria: '', contrato: '', km_limite_preventiva: '' };

export default function ParametrosPreventiva({ veiculos = [], onToast }) {
  const sessao = useMemo(() => lerSessao(), []);
  const podeGerenciar = podeEscrever(sessao?.usuario, 'frota');

  const [parametros, setParametros] = useState([]);
  const [padraoKm, setPadraoKm] = useState(10000);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [modal, setModal] = useState(null); // null | { ...MODAL_VAZIO, editando: bool }
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState(null);
  const [excluindo, setExcluindo] = useState(null);

  const modelos = useMemo(() => {
    const set = new Set();
    (veiculos || []).forEach((v) => {
      const m = String(v.modelo || '').trim();
      if (m) set.add(m);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [veiculos]);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch('/api/parametros-preventiva');
      if (!resp.ok) throw new Error(`API respondeu ${resp.status}`);
      const corpo = await resp.json();
      setParametros(Array.isArray(corpo?.data) ? corpo.data : []);
      if (corpo?.meta?.padrao_km) setPadraoKm(corpo.meta.padrao_km);
    } catch (e) {
      setErro('Não foi possível carregar os parâmetros. Verifique se o backend está no ar.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const abrirNovo = () => {
    setErroModal(null);
    setModal({ ...MODAL_VAZIO, editando: false });
  };

  const abrirEdicao = (p) => {
    setErroModal(null);
    setModal({
      categoria: p.categoria || '',
      contrato: p.contrato || '',
      km_limite_preventiva: p.km_limite_preventiva ?? '',
      editando: true,
    });
  };

  const salvar = async () => {
    const limite = Number(modal.km_limite_preventiva);
    if (!String(modal.categoria || '').trim()) {
      setErroModal('Informe a categoria/tipo do veículo.');
      return;
    }
    if (!Number.isInteger(limite) || limite <= 0) {
      setErroModal('O limite deve ser um número inteiro maior que zero.');
      return;
    }
    setSalvando(true);
    setErroModal(null);
    try {
      const resp = await fetch('/api/parametros-preventiva', {
        method: 'POST',
        headers: authHeaders(sessao),
        body: JSON.stringify({
          categoria: modal.categoria,
          contrato: modal.contrato || null,
          km_limite_preventiva: limite,
        }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `API respondeu ${resp.status}`);
      setModal(null);
      await carregar();
      onToast?.('Parâmetro salvo com sucesso!');
    } catch (e) {
      setErroModal(e.message || 'Falha ao salvar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (p) => {
    const alvo = p.contrato ? `${p.categoria} (${p.contrato})` : p.categoria;
    if (!window.confirm(`Excluir o parâmetro "${alvo}"? Os veículos voltam ao limite padrão.`)) return;
    setExcluindo(p.id);
    try {
      const resp = await fetch(`/api/parametros-preventiva/${p.id}`, {
        method: 'DELETE',
        headers: authHeaders(sessao),
      });
      if (!resp.ok && resp.status !== 204) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.message || `API respondeu ${resp.status}`);
      }
      await carregar();
      onToast?.('Parâmetro excluído.');
    } catch (e) {
      alert(e.message || 'Falha ao excluir.');
    } finally {
      setExcluindo(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-omega-accent uppercase tracking-wider">Preventiva parametrizada</div>
          <h1 className="mt-0.5 text-xl font-extrabold text-omega-900 tracking-tight sm:text-2xl">
            Limites por Categoria
          </h1>
          <p className="text-xs text-omega-500 mt-1">
            Regras por categoria (modelo) e contrato alimentam o diagnóstico, os alertas do formulário e a projeção.
            Sem regra, vale o padrão de {Number(padraoKm).toLocaleString('pt-BR')} km.
          </p>
        </div>
        {podeGerenciar && (
          <button onClick={abrirNovo} className="btn-primary !py-2 text-xs shrink-0">
            <Plus size={14} /> Novo Parâmetro
          </button>
        )}
      </div>

      {!podeGerenciar && (
        <div className="card p-3 text-xs text-omega-500 bg-omega-50">
          Seu perfil é somente leitura neste módulo. Alterações: Gestão/Transporte ou ADM Master.
        </div>
      )}

      {erro && (
        <div className="card p-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border-red-200">
          <AlertTriangle size={16} /> {erro}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-omega-400 border-b border-omega-100">
                <th className="px-4 py-3">Categoria / Tipo</th>
                <th className="px-4 py-3">Contrato</th>
                <th className="px-4 py-3 text-right">Limite (km)</th>
                {podeGerenciar && <th className="px-4 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-omega-100">
              {carregando && (
                <tr><td colSpan={podeGerenciar ? 4 : 3} className="px-4 py-8 text-center text-sm text-omega-400"><Loader2 size={16} className="animate-spin inline mr-2" />Carregando...</td></tr>
              )}
              {!carregando && parametros.length === 0 && (
                <tr><td colSpan={podeGerenciar ? 4 : 3} className="px-4 py-8 text-center text-sm text-omega-400 italic">Nenhum parâmetro cadastrado. Vale o padrão.</td></tr>
              )}
              {parametros.map((p) => (
                <tr key={p.id} className="hover:bg-omega-50/60">
                  <td className="px-4 py-3 font-bold text-omega-900">{p.categoria}</td>
                  <td className="px-4 py-3 text-omega-500 text-xs">{p.contrato || <span className="chip bg-omega-100 text-omega-500">Global (todos)</span>}</td>
                  <td className="px-4 py-3 text-right font-extrabold tabular-nums text-omega-900">{Number(p.km_limite_preventiva).toLocaleString('pt-BR')}</td>
                  {podeGerenciar && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => abrirEdicao(p)} title="Editar limite" className="p-1.5 rounded-lg text-omega-400 hover:text-omega-900 hover:bg-omega-100 transition-colors">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => excluir(p)} disabled={excluindo === p.id} title="Excluir" className="p-1.5 rounded-lg text-omega-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40">
                          {excluindo === p.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.editando ? 'Editar Parâmetro' : 'Novo Parâmetro'}
        subtitle="Limite de km entre preventivas por categoria"
        size="sm"
        footer={
          <>
            <button onClick={() => setModal(null)} disabled={salvando} className="btn-secondary">Cancelar</button>
            <button onClick={salvar} disabled={salvando} className="btn-primary disabled:opacity-50">
              {salvando ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : <><Settings2 size={15} /> Salvar</>}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {erroModal && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200/60 text-xs font-semibold text-red-700">{erroModal}</div>
          )}
          <div>
            <label className="label">Categoria / Tipo de Veículo <span className="text-status-vermelho">*</span></label>
            <input
              value={modal?.categoria || ''}
              onChange={(e) => setModal({ ...modal, categoria: e.target.value })}
              readOnly={modal?.editando}
              title={modal?.editando ? 'A categoria identifica a regra (para renomear, exclua e crie de novo)' : undefined}
              className={`input uppercase ${modal?.editando ? 'bg-omega-50 text-omega-500' : ''}`}
              placeholder="Ex: CAMINHÕES"
              list="param-categorias"
              autoFocus={!modal?.editando}
            />
            <datalist id="param-categorias">
              {modelos.map((m) => <option key={m} value={m.toUpperCase()} />)}
            </datalist>
          </div>
          <div>
            <label className="label">Contrato <span className="text-omega-400 font-normal">(opcional — vazio = todos)</span></label>
            <input
              value={modal?.contrato || ''}
              onChange={(e) => setModal({ ...modal, contrato: e.target.value })}
              className="input"
              placeholder="Ex: CT251 (vazio = regra global)"
            />
          </div>
          <div>
            <label className="label">KM Limite para Preventiva <span className="text-status-vermelho">*</span></label>
            <input
              type="number"
              min="1"
              step="1"
              value={modal?.km_limite_preventiva ?? ''}
              onChange={(e) => setModal({ ...modal, km_limite_preventiva: e.target.value })}
              className="input tabular-nums"
              placeholder="Ex: 10000"
              autoFocus={modal?.editando}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
