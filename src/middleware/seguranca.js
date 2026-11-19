// ============================================================================
// Endurecimento basico: cabecalhos de seguranca e limite de tentativas de login.
// (Operacional entra so com a matricula: sem limite, bastaria chutar matriculas.)
// ============================================================================

/** Cabecalhos de seguranca em todas as respostas. */
export function cabecalhosDeSeguranca(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

const JANELA_MS = 15 * 60 * 1000;
const LIMITE_POR_IP = 30; // falhas por IP na janela
const LIMITE_POR_MATRICULA = 15; // falhas por matricula na janela (alem do IP: cobre troca de IP)
const MAX_CHAVES = 20000; // teto de memoria

/**
 * Cria o limitador de tentativas: conta respostas de FALHA (401/404 = credencial
 * ou matricula inexistente) por IP e por matricula; passado o limite, responde 429
 * ate a janela esvaziar. Acertos nao zeram o contador (senao uma conta valida
 * serviria para "lavar" os chutes). Em memoria: vale para uma instancia (Render).
 */
export function criarLimitadorDeLogin({ agora = () => Date.now(), janelaMs = JANELA_MS, limiteIp = LIMITE_POR_IP, limiteMatricula = LIMITE_POR_MATRICULA } = {}) {
  const falhas = new Map(); // chave -> [timestamps]

  const recentes = (chave) => {
    const lista = (falhas.get(chave) || []).filter((t) => agora() - t < janelaMs);
    if (lista.length) falhas.set(chave, lista);
    else falhas.delete(chave);
    return lista;
  };
  const registrar = (chave) => {
    if (falhas.size >= MAX_CHAVES && !falhas.has(chave)) falhas.delete(falhas.keys().next().value);
    falhas.set(chave, [...recentes(chave), agora()]);
  };

  function middleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'desconhecido';
    const matricula = String(req.body?.matricula ?? '').trim().toLowerCase().slice(0, 60);
    const chaveIp = `ip:${ip}`;
    const chaveMatricula = matricula ? `m:${matricula}` : null;

    const bloqueio = [
      [chaveIp, limiteIp],
      ...(chaveMatricula ? [[chaveMatricula, limiteMatricula]] : []),
    ].map(([chave, limite]) => ({ lista: recentes(chave), limite })).find(({ lista, limite }) => lista.length >= limite);
    if (bloqueio) {
      const espera = Math.max(Math.ceil((bloqueio.lista[0] + janelaMs - agora()) / 1000), 1);
      res.setHeader('Retry-After', String(espera));
      return res.status(429).json({
        error: 'Muitas tentativas',
        message: `Muitas tentativas de login. Tente novamente em ${Math.ceil(espera / 60)} minuto(s).`,
      });
    }

    res.on('finish', () => {
      if (res.statusCode === 401 || res.statusCode === 404) {
        registrar(chaveIp);
        if (chaveMatricula) registrar(chaveMatricula);
      }
    });
    return next();
  }
  middleware.limpar = () => falhas.clear();
  return middleware;
}

export const limitarTentativasDeLogin = criarLimitadorDeLogin();
