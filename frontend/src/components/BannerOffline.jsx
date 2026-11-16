import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, UploadCloud, X } from 'lucide-react';
import { useModoOffline } from '../offline/index.js';

function horaCurta(ms) {
  if (!ms) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms));
}

// Faixa discreta no topo do conteúdo: modo offline, fila pendente e o
// resultado da última sincronização.
export default function BannerOffline() {
  const {
    online, servindoCache, cacheSalvoEm, pendentes, sincronizando, precisaLogin,
    ultimoResultado, sincronizar, limparResultado,
  } = useModoOffline();

  // Sucesso some sozinho; recusas ficam até o usuário fechar.
  useEffect(() => {
    if (!ultimoResultado || ultimoResultado.rejeitados.length) return undefined;
    const t = setTimeout(limparResultado, 6000);
    return () => clearTimeout(t);
  }, [ultimoResultado]); // eslint-disable-line react-hooks/exhaustive-deps

  const offline = !online || servindoCache;
  if (!offline && !pendentes && !ultimoResultado) return null;

  return (
    <div className="space-y-1.5 mb-3" role="status" aria-live="polite">
      {offline && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          <CloudOff size={14} className="shrink-0" />
          <span className="font-semibold">Modo Offline</span>
          <span>• Exibindo dados salvos localmente{servindoCache && cacheSalvoEm ? ` (salvos em ${horaCurta(cacheSalvoEm)})` : ''}</span>
        </div>
      )}

      {pendentes > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800">
          <UploadCloud size={14} className="shrink-0" />
          <span>
            <span className="font-semibold">{pendentes} alteração(ões) aguardando sincronização.</span>
            {precisaLogin
              ? ' Sua sessão expirou: saia e entre novamente para enviar.'
              : ' Serão enviadas automaticamente quando a conexão voltar.'}
          </span>
          {!precisaLogin && (
            <button type="button" onClick={sincronizar} disabled={sincronizando}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold hover:bg-blue-100 disabled:opacity-60">
              <RefreshCw size={12} className={sincronizando ? 'animate-spin' : ''} />
              {sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
            </button>
          )}
        </div>
      )}

      {ultimoResultado && (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-1.5 text-xs ${ultimoResultado.rejeitados.length
          ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {ultimoResultado.rejeitados.length
            ? <AlertTriangle size={14} className="shrink-0 mt-px" />
            : <CheckCircle2 size={14} className="shrink-0 mt-px" />}
          <div className="min-w-0 flex-1">
            <span className="font-semibold">
              Sincronização concluída • {ultimoResultado.enviados} alteração(ões) enviada(s)
            </span>
            {ultimoResultado.rejeitados.length > 0 && (
              <ul className="mt-0.5 list-disc pl-4">
                {ultimoResultado.rejeitados.map((r, i) => (
                  <li key={i}>Não aplicada: {r.descricao} — {r.mensagem}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" onClick={limparResultado} aria-label="Fechar aviso" className="shrink-0 rounded p-0.5 hover:bg-black/5">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
