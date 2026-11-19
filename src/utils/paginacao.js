// ============================================================================
// Paginacao das listagens. Sem teto, `?limit=1000000` leria a tabela inteira;
// a pagina minima e 1. As telas que precisam de todos os registros buscam pagina
// a pagina (frontend: buscarTodasPaginas).
// ============================================================================
export const LIMITE_MAXIMO_PADRAO = 500;

/** { page, limit, skip } a partir de ?page= e ?limit= (padrao e maximo configuraveis). */
export function lerPaginacao(query = {}, { padrao = 50, maximo = LIMITE_MAXIMO_PADRAO } = {}) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pedido = Number.parseInt(query.limit, 10);
  const limit = pedido > 0 ? Math.min(pedido, maximo) : padrao; // zero/negativo/lixo = padrao
  return { page, limit, skip: (page - 1) * limit };
}

/** Bloco `pagination` padrao das respostas. */
export function blocoPaginacao({ page, limit }, total) {
  return { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
}
