// ============================================================================
// Cache curtissimo do usuario da sessao (por id). Cada requisicao autenticada
// precisava consultar o usuario no banco (um round trip, caro com banco remoto) e
// uma tela dispara varias requisicoes de uma vez. TTL curto + invalidacao em TODA
// escrita de usuario (feita no cliente Prisma, ver escopoDados.js), entao
// transferir de contrato, trocar nivel/setor, excluir ou mudar assinatura valem na hora
// (nesta instancia); com varias instancias o atraso maximo e o TTL.
// Desligado com CACHE_USUARIO_MS=0 e quando o cliente do banco e um stub de teste.
// ============================================================================
export const TTL_USUARIO_MS = Number(process.env.CACHE_USUARIO_MS ?? 10000);
const MAX_ENTRADAS = 2000;

const entradas = new Map(); // id -> { usuario, expira }

export function lerUsuarioDoCache(id) {
  const entrada = entradas.get(id);
  if (!entrada) return null;
  if (entrada.expira <= Date.now()) {
    entradas.delete(id);
    return null;
  }
  return { ...entrada.usuario }; // copia: ninguem altera o que esta guardado
}

export function guardarUsuarioNoCache(id, usuario) {
  if (!usuario) return;
  if (entradas.size >= MAX_ENTRADAS) entradas.delete(entradas.keys().next().value);
  entradas.set(id, { usuario: { ...usuario }, expira: Date.now() + TTL_USUARIO_MS });
}

/** Esquece tudo (escrita em usuario: simples e seguro, a tabela e pequena). */
export function invalidarCacheUsuarios() {
  entradas.clear();
}
