import { useEffect, useMemo, useState } from 'react';
import {
  Users, ShieldCheck, Pencil, Trash2, ArrowUpCircle, ArrowDownCircle,
  Plus, ListChecks, ClipboardPaste, Eye, Save, X, RefreshCw,
  AlertTriangle, CheckCircle2, UserCog, HardHat, PenTool,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import SignatureCanvasModal from '../components/SignatureCanvasModal.jsx';
import {
  SETOR_LABEL, ehMaster,
} from '../utils/permissoes.js';
import { authHeaders } from '../utils/sessao.js';

const SETOR_BADGE = {
  MEIO_AMBIENTE: 'bg-emerald-500/15 text-emerald-700',
  TRANSPORTE: 'bg-omega-accent/15 text-omega-accent',
  GESTAO: 'bg-violet-500/15 text-violet-700',
};

function formatarData(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function NivelBadge({ nivel }) {
  if (nivel === 'MASTER') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-violet-600 text-white whitespace-nowrap">
        <ShieldCheck size={11} /> Master
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-omega-100 text-omega-600 whitespace-nowrap">
      Normal
    </span>
  );
}

// Cargos comuns (sugestões; digitação livre continua permitida).
const FUNCOES_SUGERIDAS = [
  'Técnico de Planejamento',
  'Coordenador',
  'Gestor',
  'Analista',
  'Encarregado',
  'Motorista',
  'Operador',
  'Ajudante',
];

function parseLote(texto, matriculasExistentes) {
  const vistas = new Set();
  return String(texto || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((linha, i) => {
      const partes = linha.split(';').map((p) => p.trim());
      const matricula = partes[0] || '';
      const nome = partes[1] || '';
      const funcao = partes.slice(2).join(';').trim();
      let status = 'ok';
      let motivo = '';
      if (!matricula || !nome) {
        status = 'invalida';
        motivo = 'Use o formato `Matrícula ; Nome Completo ; Função` (função opcional)';
      } else if (matriculasExistentes.has(matricula.toUpperCase())) {
        status = 'duplicada';
        motivo = 'Matrícula já cadastrada no banco';
      } else if (vistas.has(matricula.toUpperCase())) {
        status = 'duplicada';
        motivo = 'Matrícula repetida no lote';
      }
      vistas.add(matricula.toUpperCase());
      return { linha: i + 1, matricula, nome, funcao, status, motivo };
    });
}

export default function UsuariosView({ sessao }) {
  const [aba, setAba] = useState('lista'); // lista | adicionar
  const [modoCadastro, setModoCadastro] = useState('operacional'); // operacional | admin
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [toast, setToast] = useState(null);
  const [textoLote, setTextoLote] = useState('');
  const [preview, setPreview] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [formAdmin, setFormAdmin] = useState({
    nome: '', matricula: '', funcao: '', contrato: '', setor: 'TRANSPORTE', nivel: 'NORMAL', senha: '',
  });
  const [modalEdicao, setModalEdicao] = useState(null); // { id, tipo, nome, contrato, setor, senha, assinatura_url, assinatura_base64 }
  const [canvasEdicaoAberto, setCanvasEdicaoAberto] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch('/api/usuarios');
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const { data } = await resp.json();
      setUsuarios(Array.isArray(data) ? data : []);
    } catch (e) {
      setErro('Não foi possível carregar os usuários. Verifique se o backend está no ar.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const admins = useMemo(() => usuarios.filter((u) => u.tipo === 'ADMINISTRADOR'), [usuarios]);
  const operacionais = useMemo(() => usuarios.filter((u) => u.tipo === 'OPERACIONAL'), [usuarios]);
  // Atuante = usuario logado (sessao JWT). Sem login nao ha escrita.
  const atuante = sessao?.usuario || null;
  const souMaster = ehMaster(atuante);
  const matriculasExistentes = useMemo(
    () => new Set(usuarios.map((u) => String(u.matricula).toUpperCase())),
    [usuarios]
  );

  const headers = () => authHeaders(sessao);

  const tratarErroApi = async (resp, padrao) => {
    const corpo = await resp.json().catch(() => ({}));
    throw new Error(corpo.message || `${padrao} (API ${resp.status})`);
  };

  // ---- Admin: individual ----
  const salvarAdmin = async () => {
    if (!formAdmin.nome.trim() || !formAdmin.matricula.trim()) {
      setToast('Nome e matrícula são obrigatórios.');
      return;
    }
    setSalvando(true);
    try {
      const resp = await fetch('/api/usuarios/admin', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(formAdmin),
      });
      if (!resp.ok) await tratarErroApi(resp, 'Falha ao cadastrar administrador');
      setToast('Administrador cadastrado com sucesso!');
      setFormAdmin({ nome: '', matricula: '', funcao: '', contrato: '', setor: 'TRANSPORTE', nivel: 'NORMAL', senha: '' });
      carregar();
    } catch (e) {
      setToast(e.message);
    } finally {
      setSalvando(false);
    }
  };

  // ---- Operacional: lote ----
  const preVisualizar = () => {
    setPreview(parseLote(textoLote, matriculasExistentes));
  };

  const salvarLote = async () => {
    const linhas = preview || parseLote(textoLote, matriculasExistentes);
    const validas = linhas.filter((l) => l.status === 'ok');
    if (validas.length === 0) {
      setToast('Nenhuma linha válida para salvar. Confira o formato.');
      return;
    }
    setSalvando(true);
    try {
      const resp = await fetch('/api/usuarios/lote', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ usuarios: validas.map((l) => ({ matricula: l.matricula, nome: l.nome, funcao: l.funcao || null })) }),
      });
      if (!resp.ok) await tratarErroApi(resp, 'Falha ao salvar lote');
      const { data } = await resp.json();
      setToast(`Lote salvo: ${data.criados} criado(s), ${data.ignorados.length} ignorado(s).`);
      setTextoLote('');
      setPreview(null);
      carregar();
    } catch (e) {
      setToast(e.message);
    } finally {
      setSalvando(false);
    }
  };

  // ---- Edicao / nivel / exclusao ----
  const salvarEdicao = async () => {
    if (!modalEdicao) return;
    setSalvando(true);
    try {
      const corpo = { nome: modalEdicao.nome, contrato: modalEdicao.contrato || null, funcao: modalEdicao.funcao || null };
      if (modalEdicao.tipo === 'ADMINISTRADOR') corpo.setor = modalEdicao.setor;
      if (modalEdicao.senha) corpo.senha = modalEdicao.senha;
      if (modalEdicao.remover_assinatura) corpo.remover_assinatura = true;
      if (modalEdicao.assinatura_base64) corpo.assinatura_base64 = modalEdicao.assinatura_base64;
      const resp = await fetch(`/api/usuarios/${modalEdicao.id}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(corpo),
      });
      if (!resp.ok) await tratarErroApi(resp, 'Falha ao atualizar');
      setToast('Usuário atualizado!');
      setModalEdicao(null);
      carregar();
    } catch (e) {
      setToast(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const alternarNivel = async (u) => {
    const novo = u.nivel === 'MASTER' ? 'NORMAL' : 'MASTER';
    const acao = novo === 'MASTER' ? 'promover a Master' : 'rebaixar a Normal';
    if (!window.confirm(`${acao} ${u.nome} (${u.matricula})?`)) return;
    try {
      const resp = await fetch(`/api/usuarios/${u.id}/nivel`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ nivel: novo }),
      });
      if (!resp.ok) await tratarErroApi(resp, 'Falha ao alterar nível');
      setToast(`Nível alterado para ${novo}.`);
      carregar();
    } catch (e) {
      setToast(e.message);
    }
  };

  const excluir = async (u) => {
    if (!window.confirm(`Excluir ${u.nome} (${u.matricula})?`)) return;
    try {
      const resp = await fetch(`/api/usuarios/${u.id}`, { method: 'DELETE', headers: headers() });
      if (!resp.ok && resp.status !== 204) await tratarErroApi(resp, 'Falha ao excluir');
      setToast('Usuário excluído.');
      carregar();
    } catch (e) {
      setToast(e.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-violet-600 uppercase tracking-wider">Administração</div>
          <h1 className="mt-0.5 text-xl font-extrabold text-omega-900 tracking-tight sm:text-2xl">
            Gestão de Usuários
          </h1>
          <div className="text-[11px] text-omega-500 mt-0.5">
            {admins.length} administrador(es) • {operacionais.length} operacional(is)
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white border border-omega-200 pl-1 pr-3 py-1">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-omega-accent flex items-center justify-center font-black text-white text-xs">
            {String(atuante?.nome || '?').trim().charAt(0).toUpperCase()}
          </span>
          <span className="text-left leading-tight">
            <span className="block text-xs font-extrabold text-omega-900 max-w-[140px] truncate">
              {atuante?.nome || 'Sessão inválida'}
            </span>
            <span className="block text-[10px] font-bold text-omega-500">
              {atuante ? `${atuante.matricula} • ${atuante.nivel}` : 'somente leitura'}
            </span>
          </span>
        </div>
      </div>

      {admins.length === 0 && !carregando && (
        <div className="p-3.5 rounded-xl bg-violet-50 border border-violet-200/60 text-sm text-violet-900">
          Nenhum administrador cadastrado. Use a aba <b>Adicionar Novos Usuários → Administrador</b> para
          criar o primeiro acesso (bootstrap liberado uma única vez).
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-omega-200 pb-0.5 shrink-0">
        {[
          { k: 'lista', label: 'Lista de Usuários', icon: ListChecks },
          { k: 'adicionar', label: 'Adicionar Novos Usuários', icon: Plus },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setAba(t.k)}
            className={
              'flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-t-lg transition-all -mb-px whitespace-nowrap ' +
              (aba === t.k
                ? 'bg-white border border-b-0 border-omega-200 text-omega-900'
                : 'text-omega-500 hover:text-omega-800 hover:bg-omega-100/50 border border-transparent')
            }
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {aba === 'lista' && (
        <div className="space-y-5">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-omega-100 bg-omega-50/50">
              <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center text-violet-600">
                <UserCog size={14} />
              </div>
              <div className="text-sm font-bold text-omega-900">Administradores / Gestão</div>
              <div className="text-[11px] text-omega-500 ml-auto">{admins.length} registro(s)</div>
            </div>
            {carregando ? (
              <div className="flex items-center justify-center p-8 text-omega-500 text-sm font-semibold">
                <RefreshCw size={20} className="animate-spin mr-2" /> Carregando...
              </div>
            ) : erro ? (
              <div className="p-8 text-center text-sm text-omega-600">
                <AlertTriangle size={22} className="mx-auto text-status-amarelo mb-2" /> {erro}
              </div>
            ) : admins.length === 0 ? (
              <div className="p-8 text-center text-sm text-omega-500">Nenhum administrador cadastrado.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead className="bg-omega-50/70">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-bold border-b border-omega-100">
                      <th className="px-4 py-3">Nome</th>
                      <th className="px-4 py-3">Matrícula</th>
                      <th className="px-4 py-3">Função</th>
                      <th className="px-4 py-3">Setor</th>
                      <th className="px-4 py-3">Nível</th>
                      <th className="px-4 py-3">Assinatura</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-omega-100">
                    {admins.map((a) => (
                      <tr key={a.id} className="hover:bg-omega-50/60">
                        <td className="px-4 py-2.5 font-bold text-omega-900">{a.nome}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-omega-600">{a.matricula}</td>
                        <td className="px-4 py-2.5 text-omega-700">{a.funcao || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${SETOR_BADGE[a.setor] || 'bg-omega-100 text-omega-600'}`}>
                            {SETOR_LABEL[a.setor] || a.setor}
                          </span>
                        </td>
                        <td className="px-4 py-2.5"><NivelBadge nivel={a.nivel} /></td>
                        <td className="px-4 py-2.5">
                          {a.assinatura_url ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20" title="Assinatura digital cadastrada">
                              <CheckCircle2 size={11} /> Ativa
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-omega-100 text-omega-500">
                              Pendente
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => setModalEdicao({ id: a.id, tipo: a.tipo, matricula: a.matricula, nome: a.nome, funcao: a.funcao || '', contrato: a.contrato || '', setor: a.setor, senha: '', assinatura_url: a.assinatura_url || null })}
                              disabled={!atuante}
                              title={atuante ? 'Editar' : 'Selecione um atuante'}
                              className="p-1.5 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              onClick={() => alternarNivel(a)}
                              disabled={!souMaster}
                              title={souMaster ? (a.nivel === 'MASTER' ? 'Rebaixar a Normal' : 'Promover a Master') : 'Apenas Master altera níveis'}
                              className="p-1.5 rounded-md hover:bg-violet-50 text-omega-400 hover:text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              {a.nivel === 'MASTER' ? <ArrowDownCircle size={15} /> : <ArrowUpCircle size={15} />}
                            </button>
                            <button
                              onClick={() => excluir(a)}
                              disabled={!atuante}
                              title={a.nivel === 'MASTER' ? 'Excluir Master (requer atuante Master)' : 'Excluir'}
                              className="p-1.5 rounded-md hover:bg-red-50 text-omega-400 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-omega-100 bg-omega-50/50">
              <div className="w-7 h-7 rounded-lg bg-omega-accent/15 flex items-center justify-center text-omega-accent">
                <HardHat size={14} />
              </div>
              <div className="text-sm font-bold text-omega-900">Usuários Operacionais</div>
              <div className="text-[11px] text-omega-500 ml-auto">{operacionais.length} registro(s) • equipe de campo (partes diárias)</div>
            </div>
            {carregando ? (
              <div className="flex items-center justify-center p-8 text-omega-500 text-sm font-semibold">
                <RefreshCw size={20} className="animate-spin mr-2" /> Carregando...
              </div>
            ) : operacionais.length === 0 ? (
              <div className="p-8 text-center text-sm text-omega-500">
                Nenhum operacional cadastrado. Use a aba Adicionar → cadastro em lote.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead className="bg-omega-50/70">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-bold border-b border-omega-100">
                      <th className="px-4 py-3">Matrícula</th>
                      <th className="px-4 py-3">Nome Completo</th>
                      <th className="px-4 py-3">Função</th>
                      <th className="px-4 py-3">Assinatura</th>
                      <th className="px-4 py-3">Data de Cadastro</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-omega-100">
                    {operacionais.map((u) => (
                      <tr key={u.id} className="hover:bg-omega-50/60">
                        <td className="px-4 py-2.5 font-mono text-xs font-bold text-omega-800">{u.matricula}</td>
                        <td className="px-4 py-2.5 text-omega-700">{u.nome}</td>
                        <td className="px-4 py-2.5 text-omega-700">{u.funcao || '—'}</td>
                        <td className="px-4 py-2.5">
                          {u.assinatura_url ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20" title="Assinatura digital cadastrada">
                              <CheckCircle2 size={11} /> Ativa
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-omega-100 text-omega-500">
                              Pendente
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-xs text-omega-600">{formatarData(u.created_at)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => setModalEdicao({ id: u.id, tipo: u.tipo, matricula: u.matricula, nome: u.nome, funcao: u.funcao || '', contrato: u.contrato || '', setor: '', senha: '', assinatura_url: u.assinatura_url || null })}
                              disabled={!atuante}
                              title={atuante ? 'Editar' : 'Selecione um atuante'}
                              className="p-1.5 rounded-md hover:bg-omega-100 text-omega-600 hover:text-omega-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              onClick={() => excluir(u)}
                              disabled={!atuante}
                              title={atuante ? 'Excluir' : 'Selecione um atuante'}
                              className="p-1.5 rounded-md hover:bg-red-50 text-omega-400 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {aba === 'adicionar' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => setModoCadastro('operacional')}
              className={`card p-4 text-left transition-all ${modoCadastro === 'operacional' ? 'ring-2 ring-omega-accent shadow-md' : 'hover:shadow-md'}`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-omega-accent/15 flex items-center justify-center text-omega-accent">
                  <ClipboardPaste size={18} />
                </div>
                <div>
                  <div className="text-sm font-extrabold text-omega-900">Usuário Operacional</div>
                  <div className="text-[11px] text-omega-500">Cadastro em lote via Excel (Matrícula ; Nome ; Função)</div>
                </div>
              </div>
            </button>
            <button
              onClick={() => setModoCadastro('admin')}
              className={`card p-4 text-left transition-all ${modoCadastro === 'admin' ? 'ring-2 ring-violet-500 shadow-md' : 'hover:shadow-md'}`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center text-violet-600">
                  <UserCog size={18} />
                </div>
                <div>
                  <div className="text-sm font-extrabold text-omega-900">Administrador</div>
                  <div className="text-[11px] text-omega-500">Cadastro individual com setor, nível e senha</div>
                </div>
              </div>
            </button>
          </div>

          {modoCadastro === 'operacional' && (
            <div className="card p-4 space-y-3">
              <div className="text-sm font-extrabold text-omega-900">Cadastro em lote — Operacionais</div>
              <div>
                <label className="label">Cole as linhas do Excel (uma por linha: Matrícula ; Nome Completo ; Função — função opcional)</label>
                <textarea
                  value={textoLote}
                  onChange={(e) => { setTextoLote(e.target.value); setPreview(null); }}
                  className="input min-h-[140px] font-mono !text-xs"
                  placeholder={'12345 ; João da Silva ; Motorista\n67890 ; Maria Souza ; Ajudante'}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={preVisualizar} className="btn-secondary !py-2 text-xs inline-flex items-center gap-1.5">
                  <Eye size={14} /> Pré-visualizar Lista
                </button>
                <button
                  onClick={salvarLote}
                  disabled={salvando || !atuante}
                  title={atuante ? 'Salvar lote' : 'Selecione um atuante administrador'}
                  className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save size={14} /> {salvando ? 'Salvando...' : 'Salvar no Banco'}
                </button>
              </div>
              {preview && (
                <div className="border border-omega-200 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-omega-50/70 text-[11px] font-bold text-omega-600">
                    Conferência: {preview.filter((l) => l.status === 'ok').length} válida(s) • {preview.filter((l) => l.status !== 'ok').length} com problema
                  </div>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-omega-100">
                        {preview.map((l) => (
                          <tr key={l.linha} className={l.status === 'ok' ? '' : 'bg-red-50/50'}>
                            <td className="px-3 py-1.5 tabular-nums text-omega-400 w-10">{l.linha}</td>
                            <td className="px-3 py-1.5 font-mono font-bold text-omega-800">{l.matricula || '—'}</td>
                            <td className="px-3 py-1.5 text-omega-700">{l.nome || '—'}</td>
                            <td className="px-3 py-1.5 text-omega-600">{l.funcao || '—'}</td>
                            <td className="px-3 py-1.5 text-right">
                              {l.status === 'ok'
                                ? <span className="inline-flex items-center gap-1 font-bold text-status-verde"><CheckCircle2 size={12} /> OK</span>
                                : <span className="font-bold text-red-600" title={l.motivo}>⚠ {l.motivo}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {modoCadastro === 'admin' && (
            <div className="card p-4 space-y-3">
              <div className="text-sm font-extrabold text-omega-900">Cadastro individual — Administrador</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Nome Completo <span className="text-status-vermelho">*</span></label>
                  <input value={formAdmin.nome} onChange={(e) => setFormAdmin({ ...formAdmin, nome: e.target.value })} className="input" placeholder="Ex: Ana Paula" />
                </div>
                <div>
                  <label className="label">Matrícula <span className="text-status-vermelho">*</span></label>
                  <input value={formAdmin.matricula} onChange={(e) => setFormAdmin({ ...formAdmin, matricula: e.target.value })} className="input font-mono" placeholder="Ex: 10234" />
                </div>
                <div>
                  <label className="label">Função</label>
                  <input
                    value={formAdmin.funcao}
                    onChange={(e) => setFormAdmin({ ...formAdmin, funcao: e.target.value })}
                    className="input"
                    placeholder="Ex: Técnico de Planejamento"
                    list="admin-funcoes"
                    autoComplete="off"
                  />
                  <datalist id="admin-funcoes">
                    {FUNCOES_SUGERIDAS.map((f) => <option key={f} value={f} />)}
                  </datalist>
                </div>
                <div>
                  <label className="label">Contrato</label>
                  <input value={formAdmin.contrato} onChange={(e) => setFormAdmin({ ...formAdmin, contrato: e.target.value })} className="input" placeholder="Ex: CT251" />
                </div>
                <div>
                  <label className="label">Senha de Acesso <span className="text-status-vermelho">*</span></label>
                  <input type="password" value={formAdmin.senha} onChange={(e) => setFormAdmin({ ...formAdmin, senha: e.target.value })} className="input" placeholder="Mínimo 4 caracteres" />
                </div>
                <div>
                  <label className="label">Setor</label>
                  <select value={formAdmin.setor} onChange={(e) => setFormAdmin({ ...formAdmin, setor: e.target.value })} className="input">
                    <option value="MEIO_AMBIENTE">Meio Ambiente</option>
                    <option value="TRANSPORTE">Transporte</option>
                    <option value="GESTAO">Gestão</option>
                  </select>
                </div>
                <div>
                  <label className="label">Nível</label>
                  <select
                    value={formAdmin.nivel}
                    onChange={(e) => setFormAdmin({ ...formAdmin, nivel: e.target.value })}
                    disabled={!souMaster && admins.length > 0}
                    title={souMaster || admins.length === 0 ? 'Escolha o nível' : 'Apenas Master define Master (selecione um atuante Master)'}
                    className="input disabled:opacity-50"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="MASTER">Master</option>
                  </select>
                  {!souMaster && admins.length > 0 && (
                    <div className="mt-1 text-[11px] text-omega-500">Nível Master habilitado apenas para atuante Master.</div>
                  )}
                </div>
              </div>
              <button
                onClick={salvarAdmin}
                disabled={salvando || (!atuante && admins.length > 0)}
                title={atuante || admins.length === 0 ? 'Cadastrar' : 'Selecione um atuante administrador'}
                className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus size={14} /> {salvando ? 'Salvando...' : 'Cadastrar Administrador'}
              </button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!modalEdicao}
        onClose={() => setModalEdicao(null)}
        title={`Editar ${modalEdicao?.tipo === 'ADMINISTRADOR' ? 'administrador' : 'operacional'} • ${modalEdicao?.matricula || ''}`}
        size="sm"
        footer={
          <>
            <button onClick={() => setModalEdicao(null)} className="btn-secondary">Cancelar</button>
            <button onClick={salvarEdicao} disabled={salvando} className="btn-primary disabled:opacity-50">
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Nome</label>
            <input value={modalEdicao?.nome || ''} onChange={(e) => setModalEdicao({ ...modalEdicao, nome: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label">Função</label>
            <input
              value={modalEdicao?.funcao || ''}
              onChange={(e) => setModalEdicao({ ...modalEdicao, funcao: e.target.value })}
              className="input"
              placeholder="Ex: Motorista"
              list="edicao-funcoes"
              autoComplete="off"
            />
            <datalist id="edicao-funcoes">
              {FUNCOES_SUGERIDAS.map((f) => <option key={f} value={f} />)}
            </datalist>
          </div>
          {modalEdicao?.tipo === 'ADMINISTRADOR' && (
            <div>
              <label className="label">Setor</label>
              <select value={modalEdicao?.setor || ''} onChange={(e) => setModalEdicao({ ...modalEdicao, setor: e.target.value })} className="input">
                <option value="MEIO_AMBIENTE">Meio Ambiente</option>
                <option value="TRANSPORTE">Transporte</option>
                <option value="GESTAO">Gestão</option>
              </select>
            </div>
          )}
          <div>
            <label className="label">Contrato</label>
            <input value={modalEdicao?.contrato || ''} onChange={(e) => setModalEdicao({ ...modalEdicao, contrato: e.target.value })} className="input" />
          </div>
          {modalEdicao?.tipo === 'ADMINISTRADOR' && (
            <div>
              <label className="label">Nova senha (opcional)</label>
              <input type="password" value={modalEdicao?.senha || ''} onChange={(e) => setModalEdicao({ ...modalEdicao, senha: e.target.value })} className="input" placeholder="Deixe vazio para manter" />
            </div>
          )}

          {/* Assinatura Digital do Usuário */}
          <div className="pt-2 border-t border-omega-100 space-y-2">
            <label className="label flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-bold text-omega-800">
                <PenTool size={13} className="text-omega-accent" /> Assinatura Digital
              </span>
              {modalEdicao?.assinatura_url && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                  Cadastrada
                </span>
              )}
            </label>
            {modalEdicao?.assinatura_url ? (
              <div className="rounded-xl border border-omega-200 bg-omega-50/50 p-3 flex items-center justify-between gap-3">
                <div className="bg-white rounded-lg p-2 border border-omega-200 shadow-sm max-w-[200px]">
                  <img src={modalEdicao.assinatura_url} alt="Assinatura" className="max-h-14 w-auto object-contain mx-auto" />
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCanvasEdicaoAberto(true)}
                    className="btn-secondary !py-1.5 !px-2.5 text-xs inline-flex items-center gap-1"
                  >
                    Alterar
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalEdicao({ ...modalEdicao, assinatura_url: null, assinatura_base64: null, remover_assinatura: true })}
                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 border border-red-200"
                    title="Remover assinatura"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCanvasEdicaoAberto(true)}
                className="w-full py-2.5 px-3 rounded-xl border border-dashed border-omega-300 hover:border-omega-accent bg-omega-50/50 hover:bg-white text-xs font-semibold text-omega-700 flex items-center justify-center gap-1.5 transition-colors"
              >
                <PenTool size={14} className="text-omega-accent" /> Desenhar / Adicionar Assinatura
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* Modal Canvas de Assinatura para Edição de Usuário */}
      <SignatureCanvasModal
        open={canvasEdicaoAberto}
        onClose={() => setCanvasEdicaoAberto(false)}
        onSalvar={(dataUrl) => {
          setModalEdicao((prev) => ({
            ...prev,
            assinatura_base64: dataUrl,
            assinatura_url: dataUrl,
            remover_assinatura: false,
          }));
          setCanvasEdicaoAberto(false);
        }}
        titulo={`Assinatura de ${modalEdicao?.nome || 'Usuário'}`}
        subtitulo="Desenhe a assinatura no quadro. Ao salvar a edição do usuário, a imagem será enviada para o Cloudinary."
      />

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-xl bg-omega-900 text-white shadow-2xl text-sm font-semibold max-w-md">
          <Users size={17} className="text-violet-400 shrink-0" />
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="ml-1 hover:bg-white/15 rounded-full p-0.5">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
