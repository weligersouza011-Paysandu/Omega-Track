import { useEffect, useMemo, useState } from 'react';
import {
  Users, ShieldCheck, Pencil, Trash2, ArrowUpCircle, ArrowDownCircle,
  Plus, ListChecks, ClipboardPaste, Eye, Save, X, RefreshCw,
  AlertTriangle, CheckCircle2, UserCog, HardHat, PenTool,
  History, ArchiveRestore, RotateCcw, Search,
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

function formatarDataHora(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function diasRestantes(deletadoEm) {
  if (!deletadoEm) return 0;
  const passados = Math.floor((Date.now() - new Date(deletadoEm).getTime()) / 86400000);
  return Math.max(0, 5 - passados);
}

function detalhesResumidos(detalhes) {
  if (!detalhes) return '—';
  try {
    const texto = JSON.stringify(detalhes);
    return texto.length > 120 ? `${texto.slice(0, 120)}…` : texto;
  } catch {
    return '—';
  }
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
  const [aba, setAba] = useState('lista'); // lista | adicionar | historico | lixeira
  const [modoCadastro, setModoCadastro] = useState('operacional'); // operacional | admin
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [toast, setToast] = useState(null);
  const [textoLote, setTextoLote] = useState('');
  const [preview, setPreview] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [logs, setLogs] = useState([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [carregandoLogs, setCarregandoLogs] = useState(false);
  const [filtrosLog, setFiltrosLog] = useState({
    q: '', usuario_id: '', modulo: '', acao: '', data_inicio: '', data_fim: '',
  });
  const [lixeira, setLixeira] = useState({ veiculos: [], partes: [] });
  const [carregandoLixeira, setCarregandoLixeira] = useState(false);
  const [restaurando, setRestaurando] = useState(null);
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

  const carregarLogs = async (filtros = filtrosLog) => {
    setCarregandoLogs(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      Object.entries(filtros).forEach(([chave, valor]) => {
        if (String(valor || '').trim()) params.set(chave, String(valor).trim());
      });
      const resp = await fetch(`/api/usuarios/logs?${params.toString()}`, { headers: headers() });
      if (!resp.ok) await tratarErroApi(resp, 'Falha ao carregar histórico');
      const corpo = await resp.json();
      setLogs(Array.isArray(corpo.data) ? corpo.data : []);
      setTotalLogs(Number(corpo.pagination?.total) || 0);
    } catch (e) {
      setToast(e.message);
    } finally {
      setCarregandoLogs(false);
    }
  };

  const carregarLixeira = async () => {
    setCarregandoLixeira(true);
    try {
      const resp = await fetch('/api/usuarios/lixeira', { headers: headers() });
      if (!resp.ok) await tratarErroApi(resp, 'Falha ao carregar lixeira');
      const { data } = await resp.json();
      setLixeira({
        veiculos: Array.isArray(data?.veiculos) ? data.veiculos : [],
        partes: Array.isArray(data?.partes) ? data.partes : [],
      });
    } catch (e) {
      setToast(e.message);
    } finally {
      setCarregandoLixeira(false);
    }
  };

  useEffect(() => {
    if (aba === 'historico') carregarLogs();
    if (aba === 'lixeira' && souMaster) carregarLixeira();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  const restaurar = async (tipo, registro) => {
    const chave = tipo === 'veiculo' ? `veiculo:${registro.tag}` : `parte:${registro.id}`;
    const rotulo = tipo === 'veiculo' ? `o veículo ${registro.tag}` : `a parte diária ${registro.tag} de ${formatarData(registro.data)}`;
    if (!window.confirm(`Restaurar ${rotulo}?`)) return;
    setRestaurando(chave);
    try {
      const url = tipo === 'veiculo'
        ? `/api/usuarios/lixeira/veiculos/${encodeURIComponent(registro.tag)}/restaurar`
        : `/api/usuarios/lixeira/partes/${encodeURIComponent(registro.id)}/restaurar`;
      const resp = await fetch(url, { method: 'POST', headers: headers() });
      if (!resp.ok) await tratarErroApi(resp, 'Falha ao restaurar');
      setToast(tipo === 'veiculo' ? 'Veículo restaurado com sucesso.' : 'Parte diária restaurada com sucesso.');
      await carregarLixeira();
      carregar();
    } catch (e) {
      setToast(e.message);
    } finally {
      setRestaurando(null);
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
          { k: 'historico', label: 'Histórico de Atividades', icon: History },
          ...(souMaster ? [{ k: 'lixeira', label: 'Lixeira', icon: ArchiveRestore }] : []),
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

      {aba === 'historico' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => { e.preventDefault(); carregarLogs(); }}
            className="card p-3"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-2">
              <div className="xl:col-span-3">
                <label className="label">Usuário</label>
                <select
                  value={filtrosLog.usuario_id}
                  onChange={(e) => setFiltrosLog({ ...filtrosLog, usuario_id: e.target.value })}
                  className="input"
                >
                  <option value="">Todos os usuários</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome} • {u.matricula}</option>
                  ))}
                </select>
              </div>
              <div className="xl:col-span-2">
                <label className="label">Módulo</label>
                <select
                  value={filtrosLog.modulo}
                  onChange={(e) => setFiltrosLog({ ...filtrosLog, modulo: e.target.value })}
                  className="input"
                >
                  <option value="">Todos</option>
                  <option value="Frota">Frota</option>
                  <option value="ParteDiaria">Parte Diária</option>
                  <option value="Eficiencia">Eficiência</option>
                  <option value="Usuarios">Usuários</option>
                </select>
              </div>
              <div className="xl:col-span-2">
                <label className="label">Ação</label>
                <input
                  value={filtrosLog.acao}
                  onChange={(e) => setFiltrosLog({ ...filtrosLog, acao: e.target.value })}
                  className="input"
                  placeholder="Ex: EXCLUIR"
                />
              </div>
              <div className="xl:col-span-2">
                <label className="label">De</label>
                <input
                  type="date"
                  value={filtrosLog.data_inicio}
                  onChange={(e) => setFiltrosLog({ ...filtrosLog, data_inicio: e.target.value })}
                  className="input"
                />
              </div>
              <div className="xl:col-span-2">
                <label className="label">Até</label>
                <input
                  type="date"
                  value={filtrosLog.data_fim}
                  onChange={(e) => setFiltrosLog({ ...filtrosLog, data_fim: e.target.value })}
                  className="input"
                />
              </div>
              <div className="xl:col-span-1 flex items-end">
                <button type="submit" className="btn-primary w-full !px-2 text-xs inline-flex items-center justify-center gap-1.5" disabled={carregandoLogs}>
                  <Search size={14} /> Filtrar
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <input
                value={filtrosLog.q}
                onChange={(e) => setFiltrosLog({ ...filtrosLog, q: e.target.value })}
                className="input max-w-sm"
                placeholder="Buscar por usuário, função, ação ou módulo..."
              />
              <button
                type="button"
                onClick={() => {
                  const vazio = { q: '', usuario_id: '', modulo: '', acao: '', data_inicio: '', data_fim: '' };
                  setFiltrosLog(vazio);
                  carregarLogs(vazio);
                }}
                className="btn-secondary !py-2 text-xs"
              >
                Limpar filtros
              </button>
              <span className="text-[11px] text-omega-500 ml-auto">{totalLogs} registro(s) encontrado(s)</span>
            </div>
          </form>

          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-omega-100 bg-omega-50/50">
              <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center text-violet-600">
                <History size={14} />
              </div>
              <div className="text-sm font-bold text-omega-900">Trilha de Auditoria</div>
              <div className="text-[11px] text-omega-500 ml-auto">Últimos 100 registros do filtro atual</div>
            </div>
            {carregandoLogs ? (
              <div className="flex items-center justify-center p-8 text-omega-500 text-sm font-semibold">
                <RefreshCw size={20} className="animate-spin mr-2" /> Carregando...
              </div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center text-sm text-omega-500">Nenhuma atividade encontrada para os filtros informados.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[980px]">
                  <thead className="bg-omega-50/70">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-bold border-b border-omega-100">
                      <th className="px-4 py-3">Data / Hora</th>
                      <th className="px-4 py-3">Usuário</th>
                      <th className="px-4 py-3">Função</th>
                      <th className="px-4 py-3">Módulo</th>
                      <th className="px-4 py-3">Ação</th>
                      <th className="px-4 py-3">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-omega-100">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-omega-50/60 align-top">
                        <td className="px-4 py-2.5 tabular-nums text-xs text-omega-600 whitespace-nowrap">
                          {formatarDataHora(log.created_at)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-bold text-omega-900">{log.nome_usuario || 'Sistema'}</div>
                          <div className="text-[10px] text-omega-400 font-mono">{log.ip_address || '—'}</div>
                        </td>
                        <td className="px-4 py-2.5 text-omega-600 text-xs">{log.funcao_usuario || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-omega-100 text-omega-700 whitespace-nowrap">
                            {log.modulo}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-black bg-violet-500/10 text-violet-700 whitespace-nowrap">
                            {log.acao}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-omega-600 max-w-[320px]">
                          {log.detalhes ? (
                            <details>
                              <summary className="cursor-pointer text-omega-accent font-semibold">Ver detalhes</summary>
                              <pre className="mt-1 p-2 rounded-lg bg-omega-50 border border-omega-100 text-[10px] leading-relaxed whitespace-pre-wrap break-all max-h-40 overflow-auto">
                                {JSON.stringify(log.detalhes, null, 2)}
                              </pre>
                            </details>
                          ) : '—'}
                          <div className="text-[10px] text-omega-400 mt-0.5">{detalhesResumidos(log.detalhes)}</div>
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

      {aba === 'lixeira' && souMaster && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/70 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle size={17} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <b>Recuperação por 5 dias.</b> Veículos e partes diárias excluídos ficam disponíveis nesta lixeira.
              Após esse prazo, não podem mais ser restaurados por esta tela.
            </div>
          </div>

          {carregandoLixeira ? (
            <div className="card flex items-center justify-center p-8 text-omega-500 text-sm font-semibold">
              <RefreshCw size={20} className="animate-spin mr-2" /> Carregando lixeira...
            </div>
          ) : lixeira.veiculos.length === 0 && lixeira.partes.length === 0 ? (
            <div className="card p-8 text-center text-sm text-omega-500">
              <ArchiveRestore size={22} className="mx-auto text-omega-400 mb-2" /> Nenhum registro na lixeira.
            </div>
          ) : (
            <>
              <div className="card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-omega-100 bg-omega-50/50">
                  <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-600">
                    <Trash2 size={14} />
                  </div>
                  <div className="text-sm font-bold text-omega-900">Veículos excluídos</div>
                  <div className="text-[11px] text-omega-500 ml-auto">{lixeira.veiculos.length} registro(s)</div>
                </div>
                {lixeira.veiculos.length === 0 ? (
                  <div className="p-6 text-center text-sm text-omega-500">Nenhum veículo na lixeira.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[860px]">
                      <thead className="bg-omega-50/70">
                        <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-bold border-b border-omega-100">
                          <th className="px-4 py-3">TAG</th>
                          <th className="px-4 py-3">Placa</th>
                          <th className="px-4 py-3">Modelo</th>
                          <th className="px-4 py-3">Contrato</th>
                          <th className="px-4 py-3">Excluído em</th>
                          <th className="px-4 py-3">Por</th>
                          <th className="px-4 py-3">Prazo</th>
                          <th className="px-4 py-3 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-omega-100">
                        {lixeira.veiculos.map((v) => (
                          <tr key={v.tag} className="hover:bg-omega-50/60">
                            <td className="px-4 py-2.5 font-black text-omega-900">{v.tag}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-omega-600">{v.placa}</td>
                            <td className="px-4 py-2.5 text-omega-700">{v.modelo || '—'}</td>
                            <td className="px-4 py-2.5 text-omega-600">{v.contrato || '—'}</td>
                            <td className="px-4 py-2.5 text-xs text-omega-600">{formatarDataHora(v.deletado_em)}</td>
                            <td className="px-4 py-2.5 text-xs text-omega-600">{v.deletado_por || '—'}</td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${diasRestantes(v.deletado_em) <= 1 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                                {diasRestantes(v.deletado_em)} dia(s)
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => restaurar('veiculo', v)}
                                disabled={restaurando === `veiculo:${v.tag}`}
                                className="btn-secondary !py-1.5 !px-2.5 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                              >
                                {restaurando === `veiculo:${v.tag}` ? <RefreshCw size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                                Restaurar
                              </button>
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
                  <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-600">
                    <Trash2 size={14} />
                  </div>
                  <div className="text-sm font-bold text-omega-900">Partes diárias excluídas</div>
                  <div className="text-[11px] text-omega-500 ml-auto">{lixeira.partes.length} registro(s)</div>
                </div>
                {lixeira.partes.length === 0 ? (
                  <div className="p-6 text-center text-sm text-omega-500">Nenhuma parte diária na lixeira.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[940px]">
                      <thead className="bg-omega-50/70">
                        <tr className="text-left text-[11px] uppercase tracking-wider text-omega-500 font-bold border-b border-omega-100">
                          <th className="px-4 py-3">TAG</th>
                          <th className="px-4 py-3">Data</th>
                          <th className="px-4 py-3">Nº Relatório</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Excluído em</th>
                          <th className="px-4 py-3">Por</th>
                          <th className="px-4 py-3">Prazo</th>
                          <th className="px-4 py-3 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-omega-100">
                        {lixeira.partes.map((p) => {
                          const veiculoExcluido = Boolean(p.veiculo?.deletado_em);
                          return (
                            <tr key={p.id} className="hover:bg-omega-50/60">
                              <td className="px-4 py-2.5 font-black text-omega-900">
                                {p.tag}
                                <div className="text-[10px] font-mono text-omega-500">{p.veiculo?.placa || '—'}</div>
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-xs text-omega-600">{formatarData(p.data)}</td>
                              <td className="px-4 py-2.5 text-xs text-omega-600">{p.numero_relatorio || '—'}</td>
                              <td className="px-4 py-2.5 text-xs text-omega-600">{p.status_operacional || '—'}</td>
                              <td className="px-4 py-2.5 text-xs text-omega-600">{formatarDataHora(p.deletado_em)}</td>
                              <td className="px-4 py-2.5 text-xs text-omega-600">{p.deletado_por || '—'}</td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${diasRestantes(p.deletado_em) <= 1 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                                  {diasRestantes(p.deletado_em)} dia(s)
                                </span>
                                {veiculoExcluido && (
                                  <div className="text-[10px] font-bold text-red-600 mt-0.5">Restaure o veículo primeiro</div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  onClick={() => restaurar('parte', p)}
                                  disabled={veiculoExcluido || restaurando === `parte:${p.id}`}
                                  title={veiculoExcluido ? 'Restaure o veículo antes de recuperar esta parte' : 'Restaurar parte diária'}
                                  className="btn-secondary !py-1.5 !px-2.5 text-xs inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {restaurando === `parte:${p.id}` ? <RefreshCw size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                                  Restaurar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
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
