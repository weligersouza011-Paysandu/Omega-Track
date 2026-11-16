import { useEffect, useState } from 'react';
import { Loader2, Plus, Power, RefreshCw, Trash2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { authHeaders } from '../utils/sessao.js';
import { mensagemFalha } from '../offline/index.js';

// Gestão das categorias de desvio de programação (motivos que o operador
// escolhe no RDO quando a obra difere da programada). Excluir uma categoria
// já usada apenas a desativa, preservando o histórico do indicador.
export default function CategoriasDesvioModal({ aberto, sessao, onFechar }) {
  const [categorias, setCategorias] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [nova, setNova] = useState('');
  const [ocupado, setOcupado] = useState(null); // id em operação ou 'nova'
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [confirmarExclusao, setConfirmarExclusao] = useState(null);

  async function carregar() {
    setCarregando(true);
    setErro('');
    try {
      const resp = await fetch('/api/categorias-desvio', { headers: authHeaders(sessao) });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `Erro ao carregar (${resp.status})`);
      setCategorias(Array.isArray(corpo.data) ? corpo.data : []);
    } catch (falha) {
      setErro(mensagemFalha(falha, 'Não foi possível carregar as categorias.'));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (!aberto) return;
    setNova('');
    setAviso('');
    setConfirmarExclusao(null);
    carregar();
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  async function chamar(id, url, opcoes, sucesso) {
    setOcupado(id);
    setErro('');
    setAviso('');
    try {
      const resp = await fetch(url, { headers: authHeaders(sessao), ...opcoes });
      const corpo = resp.status === 204 ? {} : await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `Erro (${resp.status})`);
      setAviso(sucesso(corpo));
      await carregar();
      return true;
    } catch (falha) {
      setErro(mensagemFalha(falha, 'Não foi possível concluir a operação.'));
      return false;
    } finally {
      setOcupado(null);
    }
  }

  async function adicionar(evento) {
    evento.preventDefault();
    const nome = nova.trim();
    if (!nome) return;
    if (await chamar('nova', '/api/categorias-desvio', { method: 'POST', body: JSON.stringify({ nome }) },
      (corpo) => (corpo.existente ? `"${corpo.data.nome}" já existia na lista.` : `Categoria "${nome}" adicionada.`))) setNova('');
  }

  const alternar = (c) => chamar(c.id, `/api/categorias-desvio/${c.id}`,
    { method: 'PUT', body: JSON.stringify({ ativo: !c.ativo }) },
    () => `"${c.nome}" ${c.ativo ? 'desativada' : 'ativada'}.`);

  const excluir = (c) => chamar(c.id, `/api/categorias-desvio/${c.id}`, { method: 'DELETE' },
    (corpo) => corpo.message || `"${c.nome}" excluída.`).then(() => setConfirmarExclusao(null));

  return (
    <Modal open={aberto} onClose={() => !ocupado && onFechar()} size="md"
      title="Categorias de Desvio de Programação"
      subtitle="Motivos que o operador escolhe na Parte Diária quando a obra difere da programada"
      footer={<button type="button" className="btn-secondary" onClick={onFechar} disabled={!!ocupado}>Fechar</button>}>
      <div className="space-y-4">
        <form onSubmit={adicionar} className="flex gap-2">
          <input className="input flex-1 min-w-0" value={nova} maxLength={120} onChange={(e) => setNova(e.target.value)}
            placeholder="Nova categoria (ex.: Chuva / Condição Climática)" aria-label="Nome da nova categoria" />
          <button type="submit" className="btn-primary shrink-0" disabled={!nova.trim() || !!ocupado}>
            {ocupado === 'nova' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Adicionar
          </button>
        </form>

        {erro && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
        {aviso && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</div>}

        {carregando && !categorias.length ? (
          <div className="py-8 flex items-center justify-center gap-2 text-sm text-omega-500">
            <RefreshCw size={16} className="animate-spin" /> Carregando...
          </div>
        ) : categorias.length === 0 ? (
          <p className="py-6 text-center text-sm text-omega-500">Nenhuma categoria cadastrada.</p>
        ) : (
          <ul className="divide-y divide-omega-100 rounded-xl border border-omega-100">
            {categorias.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className={`block text-sm font-semibold ${c.ativo ? 'text-omega-900' : 'text-omega-400 line-through'}`}>{c.nome}</span>
                  <span className="block text-[11px] text-omega-400">
                    {c.ativo ? 'Ativa' : 'Inativa'} · usada em {c.total_usos || 0} parte(s) diária(s)
                  </span>
                </div>
                {confirmarExclusao === c.id ? (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-omega-600">{c.total_usos ? 'Em uso: será desativada.' : 'Excluir?'}</span>
                    <button type="button" className="btn-danger !py-1 !px-2 !text-xs" onClick={() => excluir(c)} disabled={!!ocupado}>Confirmar</button>
                    <button type="button" className="btn-secondary !py-1 !px-2 !text-xs" onClick={() => setConfirmarExclusao(null)} disabled={!!ocupado}>Cancelar</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => alternar(c)} disabled={!!ocupado}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${c.ativo
                        ? 'text-amber-700 hover:bg-amber-50' : 'text-emerald-700 hover:bg-emerald-50'} disabled:opacity-50`}
                      title={c.ativo ? 'Desativar (some da Parte Diária, histórico mantido)' : 'Ativar'}>
                      {ocupado === c.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                      {c.ativo ? 'Desativar' : 'Ativar'}
                    </button>
                    <button type="button" onClick={() => setConfirmarExclusao(c.id)} disabled={!!ocupado}
                      className="p-1.5 rounded-lg text-omega-400 hover:text-status-vermelho hover:bg-red-50 disabled:opacity-50"
                      title="Excluir" aria-label={`Excluir ${c.nome}`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
