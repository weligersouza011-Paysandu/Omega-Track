// Sessao do usuario logado (JWT 12h em localStorage).
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
