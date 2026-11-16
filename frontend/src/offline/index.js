// ============================================================================
// Modo offline do Omega Track: instala o motor no `window.fetch` (todas as
// telas usam fetch('/api/...') diretamente) e mantém a fila sincronizando.
// ============================================================================
import { useSyncExternalStore } from 'react';
import { armazenamentoPadrao } from './armazenamento.js';
import { criarMotorOffline, EVENTO_SINCRONIZADO } from './motor.js';
import { authHeaders, lerSessao } from '../utils/sessao.js';

export { EVENTO_SINCRONIZADO };

const INTERVALO_POLLING_MS = 20_000;
let motor = null;

export function instalarModoOffline() {
  if (motor || typeof window === 'undefined') return motor;
  const fetchOriginal = window.fetch.bind(window);
  motor = criarMotorOffline({
    armazenamento: armazenamentoPadrao(),
    fetchOriginal,
    obterUsuario: () => lerSessao()?.usuario?.matricula || null,
    obterHeaders: () => authHeaders(lerSessao()),
  });
  window.fetch = motor.fetch;

  const tentar = () => { if (navigator.onLine) motor.sincronizar(); };
  window.addEventListener('online', () => { motor.definirOnline(true); tentar(); });
  window.addEventListener('offline', () => motor.definirOnline(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tentar(); });
  // Polling leve: `online` nem sempre dispara (ex.: Wi-Fi conectado sem internet).
  setInterval(() => { if (motor.obterEstado().pendentes > 0) tentar(); }, INTERVALO_POLLING_MS);

  armazenamentoPadrao().podarCache().catch(() => {});
  motor.atualizarPendentes().then(tentar);
  return motor;
}

// Após login (troca de usuário), recalcula pendências e tenta enviar a fila.
export function aoMudarSessao() {
  if (!motor) return;
  motor.atualizarPendentes().then(() => { if (navigator.onLine) motor.sincronizar(); });
}

const ESTADO_VAZIO = { online: true, servindoCache: false, pendentes: 0, sincronizando: false, precisaLogin: false, ultimoResultado: null };

export function useModoOffline() {
  const estado = useSyncExternalStore(
    (fn) => (motor ? motor.assinar(fn) : () => {}),
    () => (motor ? motor.obterEstado() : ESTADO_VAZIO),
  );
  return {
    ...estado,
    sincronizar: () => motor?.sincronizar(),
    limparResultado: () => motor?.limparResultado(),
  };
}

// Respostas da fila local vêm marcadas pelo motor.
export function salvoNaFila(resposta) {
  return resposta?.headers?.get('X-Omega-Offline') === 'fila';
}

export const MENSAGEM_SALVO_LOCAL = 'Alteração salva localmente • Sincronizará assim que houver conexão';

// Mensagem de erro amigável para ações que exigem internet.
export function mensagemFalha(falha, padrao) {
  if (falha instanceof TypeError && typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Sem conexão: esta ação precisa de internet. Tente novamente quando a conexão voltar.';
  }
  return falha?.message || padrao;
}
