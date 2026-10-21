import { useState } from 'react';
import { ShieldCheck, KeyRound, Save, CheckCircle2, PenTool, Trash2, RefreshCw } from 'lucide-react';
import { SETOR_LABEL } from '../utils/permissoes.js';
import { salvarSessao } from '../utils/sessao.js';
import SignatureCanvasModal from '../components/SignatureCanvasModal.jsx';

export default function PerfilView({ sessao }) {
  const [usuario, setUsuario] = useState(sessao?.usuario);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null); // { tipo: 'ok'|'erro', texto }

  const [modalAssinatura, setModalAssinatura] = useState(false);
  const [salvandoAssinatura, setSalvandoAssinatura] = useState(false);
  const [msgAssinatura, setMsgAssinatura] = useState(null);

  if (!usuario) {
    return <div className="text-sm text-omega-500">Sessão inválida. Faça login novamente.</div>;
  }

  const inicial = String(usuario.nome || '?').trim().charAt(0).toUpperCase();

  const trocarSenha = async () => {
    if (nova !== confirmar) {
      setMsg({ tipo: 'erro', texto: 'A confirmação não confere com a nova senha.' });
      return;
    }
    setSalvando(true);
    setMsg(null);
    try {
      const resp = await fetch('/api/login/senha', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessao.token}`,
        },
        body: JSON.stringify({ atual, nova }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `Falha (${resp.status})`);
      setMsg({ tipo: 'ok', texto: 'Senha atualizada com sucesso!' });
      setAtual('');
      setNova('');
      setConfirmar('');
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e.message });
    } finally {
      setSalvando(false);
    }
  };

  const salvarAssinatura = async (dataUrl) => {
    setSalvandoAssinatura(true);
    setMsgAssinatura(null);
    try {
      const resp = await fetch('/api/login/assinatura', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessao.token}`,
        },
        body: JSON.stringify({ assinatura_base64: dataUrl }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `Falha (${resp.status})`);

      const urlSalva = corpo.data?.assinatura_url || corpo.data?.usuario?.assinatura_url || null;
      const usuarioAtualizado = { ...usuario, assinatura_url: urlSalva, assinatura_padrao: urlSalva };
      setUsuario(usuarioAtualizado);
      if (sessao) {
        sessao.usuario = usuarioAtualizado;
        salvarSessao(sessao.token, usuarioAtualizado);
      }
      setModalAssinatura(false);
      setMsgAssinatura({ tipo: 'ok', texto: 'Assinatura digital cadastrada com sucesso!' });
    } catch (e) {
      setMsgAssinatura({ tipo: 'erro', texto: e.message || 'Falha ao salvar assinatura.' });
    } finally {
      setSalvandoAssinatura(false);
    }
  };

  const removerAssinatura = async () => {
    if (!window.confirm('Tem certeza que deseja remover sua assinatura digital cadastrada?')) return;
    setSalvandoAssinatura(true);
    setMsgAssinatura(null);
    try {
      const resp = await fetch('/api/login/assinatura', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessao.token}`,
        },
        body: JSON.stringify({ remover: true }),
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.message || `Falha (${resp.status})`);

      const usuarioAtualizado = { ...usuario, assinatura_url: null, assinatura_padrao: null };
      setUsuario(usuarioAtualizado);
      if (sessao) {
        sessao.usuario = usuarioAtualizado;
        salvarSessao(sessao.token, usuarioAtualizado);
      }
      setMsgAssinatura({ tipo: 'ok', texto: 'Assinatura digital removida com sucesso.' });
    } catch (e) {
      setMsgAssinatura({ tipo: 'erro', texto: e.message });
    } finally {
      setSalvandoAssinatura(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <div className="text-xs font-semibold text-violet-600 uppercase tracking-wider">Conta</div>
        <h1 className="mt-0.5 text-xl font-extrabold text-omega-900 tracking-tight sm:text-2xl">
          Meu Perfil
        </h1>
      </div>

      <div className="card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-omega-accent flex items-center justify-center font-black text-white text-2xl shrink-0">
          {inicial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-extrabold text-omega-900 truncate">{usuario.nome}</div>
          <div className="text-xs text-omega-500 font-mono">
            Matrícula {usuario.matricula}
            {usuario.contrato ? ` • Contrato ${usuario.contrato}` : ''}
            {usuario.funcao ? ` • ${usuario.funcao}` : ''}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-omega-accent/15 text-omega-accent">
              {SETOR_LABEL[usuario.setor] || usuario.setor}
            </span>
            {usuario.nivel === 'MASTER' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-violet-600 text-white">
                <ShieldCheck size={11} /> Master
              </span>
            ) : (
              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-omega-100 text-omega-600">
                Normal
              </span>
            )}
            {usuario.assinatura_url && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20">
                <CheckCircle2 size={11} /> Assinatura Ativa
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Seção 2: Assinatura Digital Fixa no Perfil */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-600">
              <PenTool size={16} />
            </div>
            <div>
              <div className="text-sm font-extrabold text-omega-900">Assinatura Digital Fixa</div>
              <div className="text-xs text-omega-500">
                Sua assinatura cadastrada é usada para validar aprovações e relatórios com 1 clique.
              </div>
            </div>
          </div>
        </div>

        {msgAssinatura && (
          <div
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${
              msgAssinatura.tipo === 'ok'
                ? 'bg-status-verde/10 text-status-verde border border-status-verde/20'
                : 'bg-red-50 text-red-700 border border-red-200/60'
            }`}
          >
            {msgAssinatura.tipo === 'ok' && <CheckCircle2 size={14} />} {msgAssinatura.texto}
          </div>
        )}

        {(usuario.assinatura_padrao || usuario.assinatura_url) ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-omega-200 bg-omega-50/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="bg-white rounded-lg p-2.5 border border-omega-200/80 shadow-sm inline-block max-w-[260px]">
                <img
                  src={usuario.assinatura_padrao || usuario.assinatura_url}
                  alt={`Assinatura de ${usuario.nome}`}
                  className="max-h-20 w-auto object-contain mx-auto"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalAssinatura(true)}
                  disabled={salvandoAssinatura}
                  className="btn-secondary !py-2 text-xs inline-flex items-center gap-1.5"
                >
                  <RefreshCw size={14} /> Alterar Assinatura
                </button>
                <button
                  type="button"
                  onClick={removerAssinatura}
                  disabled={salvandoAssinatura}
                  className="p-2 rounded-lg text-red-600 hover:bg-red-50 border border-red-200 text-xs inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  title="Remover assinatura cadastrada"
                >
                  <Trash2 size={14} /> Remover
                </button>
              </div>
            </div>
            <p className="text-[11px] text-omega-400">
              * A imagem está armazenada com segurança na nuvem e vinculada à sua matrícula.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-omega-200 bg-omega-50/30 p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-omega-100 flex items-center justify-center mx-auto text-omega-400">
              <PenTool size={22} />
            </div>
            <div>
              <div className="text-sm font-bold text-omega-800">Nenhuma assinatura cadastrada</div>
              <div className="text-xs text-omega-500 max-w-sm mx-auto mt-0.5">
                Desenhe sua assinatura digital para assinar partes diárias e relatórios operacionais sem precisar redesenhar a cada etapa.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setModalAssinatura(true)}
              className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5 shadow-sm"
            >
              <PenTool size={14} /> Desenhar / Adicionar Minha Assinatura
            </button>
          </div>
        )}
      </div>

      {/* Seção 3: Troca de Senha */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center text-violet-600">
            <KeyRound size={16} />
          </div>
          <div className="text-sm font-extrabold text-omega-900">Trocar senha</div>
        </div>
        {msg && (
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${msg.tipo === 'ok' ? 'bg-status-verde/10 text-status-verde border border-status-verde/20' : 'bg-red-50 text-red-700 border border-red-200/60'}`}>
            {msg.tipo === 'ok' && <CheckCircle2 size={14} />} {msg.texto}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Senha atual</label>
            <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} className="input" autoComplete="current-password" />
          </div>
          <div>
            <label className="label">Nova senha</label>
            <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} className="input" autoComplete="new-password" placeholder="Mínimo 4 caracteres" />
          </div>
          <div>
            <label className="label">Confirmar nova</label>
            <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} className="input" autoComplete="new-password" />
          </div>
        </div>
        <button
          onClick={trocarSenha}
          disabled={salvando || !atual || !nova}
          className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Save size={14} /> {salvando ? 'Salvando...' : 'Atualizar senha'}
        </button>
      </div>

      {/* Modal Canvas de Assinatura */}
      <SignatureCanvasModal
        open={modalAssinatura}
        onClose={() => setModalAssinatura(false)}
        onSalvar={salvarAssinatura}
        salvando={salvandoAssinatura}
        titulo="Desenhar / Adicionar Minha Assinatura"
        subtitulo="Desenhe sua assinatura no quadro abaixo. Ela será salva no Cloudinary e vinculada ao seu usuário."
      />
    </div>
  );
}

