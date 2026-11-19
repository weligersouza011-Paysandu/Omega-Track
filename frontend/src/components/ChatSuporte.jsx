import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, ArrowLeft, Inbox } from 'lucide-react';

// Chat de suporte: o usuario fala direto com o desenvolvedor (Master).
// - Usuario comum: uma unica conversa.
// - Master: caixa de entrada com as conversas de todos os usuarios (a mesma para todos os Master).
// Atualiza sozinho (consulta periodica leve) enquanto a aba esta visivel.

const INTERVALO_BADGE_MS = 30000;
const INTERVALO_CONVERSA_MS = 8000;

async function api(caminho, opcoes) {
  const resp = await fetch(`/api/suporte${caminho}`, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...(opcoes?.headers || {}) },
  });
  const corpo = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(corpo?.message || 'Não foi possível completar a ação.');
  return corpo;
}

const hora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function useNaoLidasSuporte() {
  const [total, setTotal] = useState(0);
  const atualizar = useCallback(async () => {
    if (document.hidden) return;
    try { setTotal((await api('/nao-lidas')).total || 0); } catch { /* badge e informativo */ }
  }, []);
  useEffect(() => {
    atualizar();
    const t = setInterval(atualizar, INTERVALO_BADGE_MS);
    return () => clearInterval(t);
  }, [atualizar]);
  return [total, atualizar];
}

function Conversa({ carregar, enviar, titulo, onVoltar, aoMudar }) {
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fim = useRef(null);

  const buscar = useCallback(async () => {
    if (document.hidden) return;
    try {
      setMensagens(await carregar());
      aoMudar?.();
    } catch (e) { setErro(e.message); }
  }, [carregar, aoMudar]);

  useEffect(() => {
    buscar();
    const t = setInterval(buscar, INTERVALO_CONVERSA_MS);
    return () => clearInterval(t);
  }, [buscar]);
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [mensagens.length]);

  const mandar = async (e) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setErro('');
    try {
      await enviar(t);
      setTexto('');
      await buscar();
    } catch (err) { setErro(err.message); } finally { setEnviando(false); }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {titulo && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-omega-200">
          {onVoltar && (
            <button type="button" onClick={onVoltar} aria-label="Voltar às conversas" className="p-1 rounded hover:bg-omega-100">
              <ArrowLeft size={16} />
            </button>
          )}
          <span className="text-sm font-bold text-omega-900 truncate">{titulo}</span>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 bg-omega-50">
        {mensagens.length === 0 && !erro && (
          <p className="text-center text-xs text-omega-500 py-6">
            Conte o que aconteceu: a tela, o que você tentou fazer e a mensagem que apareceu. O desenvolvedor responde por aqui.
          </p>
        )}
        {mensagens.map((m) => (
          <div key={m.id} className={`flex ${m.de_dev ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[85%] rounded-2xl px-2.5 sm:px-3 py-1.5 sm:py-2 text-[13px] sm:text-sm shadow-sm ${m.de_dev ? 'bg-white border border-omega-200 text-omega-900' : 'bg-omega-accent text-white'}`}>
              <div className={`text-[10px] font-bold mb-0.5 ${m.de_dev ? 'text-omega-brand' : 'text-white/80'}`}>
                {m.de_dev ? `Desenvolvedor · ${m.autor_nome}` : m.autor_nome}
              </div>
              <div className="whitespace-pre-wrap break-words">{m.texto}</div>
              <div className={`text-[10px] mt-1 text-right ${m.de_dev ? 'text-omega-400' : 'text-white/70'}`}>{hora(m.created_at)}</div>
            </div>
          </div>
        ))}
        <div ref={fim} />
      </div>
      {erro && <div className="px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 border-t border-red-100">{erro}</div>}
      <form onSubmit={mandar} className="flex items-end gap-2 p-2.5 sm:p-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] border-t border-omega-200 bg-white">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) mandar(e); }}
          rows={2}
          maxLength={2000}
          placeholder="Escreva sua mensagem…"
          className="input flex-1 resize-none text-base sm:text-sm"
        />
        <button type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar mensagem"
          className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-omega-accent text-white disabled:opacity-40">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

function CaixaDeEntrada({ aoMudar }) {
  const [conversas, setConversas] = useState([]);
  const [aberta, setAberta] = useState(null);
  const [erro, setErro] = useState('');

  const listar = useCallback(async () => {
    if (document.hidden) return;
    try { setConversas((await api('/conversas')).data); } catch (e) { setErro(e.message); }
  }, []);
  useEffect(() => {
    listar();
    const t = setInterval(listar, INTERVALO_CONVERSA_MS);
    return () => clearInterval(t);
  }, [listar]);

  const matricula = aberta?.matricula;
  const carregar = useCallback(async () => (await api(`/conversas/${encodeURIComponent(matricula)}`)).data, [matricula]);
  const enviar = useCallback((texto) => api(`/conversas/${encodeURIComponent(matricula)}`, { method: 'POST', body: JSON.stringify({ texto }) }), [matricula]);
  const mudou = useCallback(() => { aoMudar?.(); listar(); }, [aoMudar, listar]);

  if (aberta) {
    return <Conversa key={matricula} carregar={carregar} enviar={enviar} aoMudar={mudou}
      titulo={`${aberta.nome} · ${aberta.matricula}${aberta.contrato ? ` · contrato ${aberta.contrato}` : ''}`}
      onVoltar={() => { setAberta(null); listar(); }} />;
  }
  return (
    <div className="h-full overflow-y-auto">
      {erro && <div className="px-3 py-2 text-xs font-semibold text-red-600">{erro}</div>}
      {conversas.length === 0 && !erro && (
        <div className="flex flex-col items-center gap-2 py-12 text-omega-400 text-sm"><Inbox size={28} /> Nenhuma conversa ainda.</div>
      )}
      {conversas.map((c) => (
        <button key={c.matricula} type="button" onClick={() => setAberta(c)}
          className="w-full text-left px-3 py-2.5 border-b border-omega-100 hover:bg-omega-50 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-omega-900 truncate">{c.nome}</span>
              <span className="text-[10px] font-semibold text-omega-500 shrink-0">{c.matricula}{c.contrato ? ` · ${c.contrato}` : ''}</span>
            </div>
            <div className="text-xs text-omega-500 truncate">{c.ultima_de_dev ? 'Você: ' : ''}{c.ultima_mensagem}</div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-[10px] text-omega-400">{hora(c.ultima_em)}</span>
            {c.nao_lidas > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center">{c.nao_lidas}</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

export default function ChatSuporte({ usuario }) {
  const [aberto, setAberto] = useState(false);
  const [naoLidas, atualizarNaoLidas] = useNaoLidasSuporte();
  const master = usuario?.nivel === 'MASTER';

  const carregar = useCallback(async () => (await api('/minha')).data, []);
  const enviar = useCallback((texto) => api('/minha', { method: 'POST', body: JSON.stringify({ texto }) }), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title="Teve algum problema? Fale com o nosso desenvolvedor"
        aria-label="Teve algum problema? Fale com o nosso desenvolvedor"
        aria-expanded={aberto}
        className="relative shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-omega-accent hover:bg-omega-brand text-white px-2 min-[420px]:px-2.5 lg:px-3 h-8 sm:h-9 text-[11px] sm:text-xs font-bold shadow-sm transition-colors"
      >
        <MessageCircle size={15} className="shrink-0" />
        <span className="hidden lg:flex flex-col text-left leading-tight">
          <span>{master ? 'Chamados dos usuários' : 'Teve algum problema?'}</span>
          {!master && <span className="text-[10px] font-semibold text-white/85">Fale com o nosso desenvolvedor</span>}
        </span>
        <span className="hidden min-[420px]:inline lg:hidden">{master ? 'Chamados' : 'Ajuda'}</span>
        {naoLidas > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white ring-2 ring-white">
            {naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div className="fixed top-14 md:top-16 right-0 bottom-0 w-full sm:w-[380px] z-40 bg-white border-l border-omega-200 shadow-2xl flex flex-col"
          role="dialog" aria-label="Chat com o desenvolvedor">
          <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 bg-omega-950 text-white">
            <div className="leading-tight min-w-0">
              <div className="text-[13px] sm:text-sm font-extrabold truncate">{master ? 'Chamados dos usuários' : 'Fale com o desenvolvedor'}</div>
              <div className="text-[11px] text-white/70">{master ? 'Todos os Master veem as mesmas conversas' : 'Weliger Souza responde por aqui'}</div>
            </div>
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar chat" className="p-1.5 rounded-lg hover:bg-white/10"><X size={18} /></button>
          </div>
          <div className="flex-1 min-h-0">
            {master
              ? <CaixaDeEntrada aoMudar={atualizarNaoLidas} />
              : <Conversa carregar={carregar} enviar={enviar} aoMudar={atualizarNaoLidas} />}
          </div>
        </div>
      )}
    </>
  );
}
