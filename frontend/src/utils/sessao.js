// Sessao do usuario logado (JWT 12h em localStorage).
import { limparCacheLeituras } from '../offline/armazenamento.js';
import { lerContratoSelecionado, salvarContratoSelecionado } from './contrato.js';
import { limparCachePaginas } from './paginas.js';
const CHAVE = 'omegatrack_sessao';

export function lerSessao() {
  try {
    const raw = localStorage.getItem(CHAVE);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s?.token ? s : null;
  } catch {
    return null;
  }
}

export function salvarSessao(token, usuario) {
  localStorage.setItem(CHAVE, JSON.stringify({ token, usuario }));
}

export function encerrarSessao() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* sem armazenamento */
  }
  // O filtro de contrato do Master e as leituras guardadas para o modo offline
  // não ficam para o próximo usuário.
  salvarContratoSelecionado('');
  limparCachePaginas();
  limparCacheLeituras();
}

export async function fazerLogin(matricula, senha) {
  const corpo = { matricula };
  // Operacional autentica só com a matrícula (senha opcional/ignorada).
  if (senha) corpo.senha = senha;
  const resp = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.message || `Falha no login (${resp.status})`);
  salvarSessao(dados.data.token, dados.data.usuario);
  return dados.data;
}

// Etapa 1 do login dinâmico: checa o perfil da matrícula no banco.
// Retorna { cadastrada, exigeSenha, nome, tipo } ou lança o erro legível.
export async function verificarMatricula(matricula) {
  const resp = await fetch('/api/login/verificar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matricula }),
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(corpo.message || 'Matrícula não cadastrada no sistema.');
  return corpo.data;
}

export function authHeaders(sessao) {
  const s = sessao || lerSessao();
  const h = { 'Content-Type': 'application/json' };
  if (s?.token) h.Authorization = `Bearer ${s.token}`;
  if (s?.usuario?.matricula) h['x-acting-matricula'] = s.usuario.matricula;
  return h;
}

export function rotaInicialPorSetor(usuario) {
  if (usuario?.setor === 'MEIO_AMBIENTE') return '/controle-ambiental';
  if (usuario?.setor === 'TRANSPORTE') return '/inicio';
  return '/inicio';
}

// Todas as telas chamam fetch('/api/...') direto e a API passou a exigir login
// em todas as rotas de dados. Em vez de repetir o cabecalho em cada chamada,
// o fetch global anexa o token da sessao as chamadas para /api/ que ainda nao
// trazem `Authorization`. Chamar antes de instalarModoOffline().
const ROTAS_SEM_FILTRO_CONTRATO = ['/api/login', '/api/contratos', '/api/upload'];
const ehMaster = (u) => u?.tipo === 'ADMINISTRADOR' && u?.nivel === 'MASTER';

export function instalarAutenticacaoApi() {
  if (typeof window === 'undefined' || window.__omegaAuthFetch) return;
  const fetchBase = window.fetch.bind(window);
  window.__omegaAuthFetch = true;
  window.fetch = (input, init) => {
    try {
      const bruto = typeof input === 'string' ? input : (input?.url || '');
      const url = new URL(bruto, window.location.origin);
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
        // Qualquer escrita deixa as listas em cache (frota, obras...) desatualizadas.
        const metodo = String(init?.method || (typeof input === 'object' ? input.method : '') || 'GET').toUpperCase();
        if (metodo !== 'GET' && metodo !== 'HEAD') limparCachePaginas();
        const sessao = lerSessao();
        const token = sessao?.token;
        if (token) {
          const cabecalhos = new Headers(init?.headers || (typeof input === 'object' ? input.headers : undefined));
          const opcoes = { ...(init || {}) };
          let alvo = input;
          if (!cabecalhos.has('Authorization')) {
            cabecalhos.set('Authorization', `Bearer ${token}`);
            opcoes.headers = cabecalhos;
          }
          // Filtro de contrato do Master: vale para todas as telas, sem mexer em cada fetch.
          // (Nao-Master: o servidor ignora o parametro e usa sempre o proprio contrato.)
          const selecionado = lerContratoSelecionado();
          if (selecionado && typeof input === 'string' && ehMaster(sessao.usuario)
              && !url.searchParams.has('contrato') && !ROTAS_SEM_FILTRO_CONTRATO.some((r) => url.pathname.startsWith(r))) {
            url.searchParams.set('contrato', selecionado);
            alvo = `${url.pathname}${url.search}`;
          }
          if (opcoes.headers || alvo !== input) return fetchBase(alvo, opcoes);
        }
      }
    } catch {
      /* URL invalida: segue sem alterar */
    }
    return fetchBase(input, init);
  };
}
