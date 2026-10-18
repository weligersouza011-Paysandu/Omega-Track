// ============================================================================
// src/utils/retryBanco.js — Re-try de conexao para o banco serverless (Neon).
// Falhas transitorias (instancia acordando, pool esgotado, rede) merecem
// repeticao; erros permanentes (migration pendente, validacao) sobem na hora.
// Compartilhado entre pendenciasController e eficienciaController.
// ============================================================================

// Falha transitoria de conexao (banco serverless acordando, pool esgotado,
// rede): vale a pena repetir a consulta antes de desistir.
export function erroTransitorioDeConexao(erro) {
  const codigo = String(erro?.code || '');
  if (['P1001', 'P1002', 'P1017', 'P2024'].includes(codigo)) return true;
  return /Can't reach database server|Connection terminated|Timed out fetching a new connection|ECONNRESET|ETIMEDOUT|EPIPE|Connection reset/i
    .test(String(erro?.message || ''));
}

// Re-try de conexao: repete a consulta algumas vezes com espera progressiva
// quando o erro for transitorio (ex.: Neon acordando). `rotulo` identifica o
// modulo no log.
export async function comRetryConexao(fn, tentativas = 3, esperaMs = 700, rotulo = 'banco') {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await fn();
    } catch (erro) {
      if (tentativa >= tentativas || !erroTransitorioDeConexao(erro)) throw erro;
      console.warn(
        `[${rotulo}] Falha transitoria de banco (tentativa ${tentativa}/${tentativas}) — repetindo consulta...`,
        { code: erro?.code, message: erro?.message },
      );
      await new Promise((resolve) => setTimeout(resolve, esperaMs * tentativa));
    }
  }
}
