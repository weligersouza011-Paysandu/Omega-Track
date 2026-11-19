// ============================================================================
// Busca TODAS as paginas de uma listagem (a API limita cada pagina). Antes as
// telas pediam `?limit=200` e ignoravam o resto: com mais de 200 veiculos (ou
// varios contratos no filtro "Todos") parte dos dados sumia sem aviso.
// ============================================================================
export const TAMANHO_PAGINA = 200;
const MAX_PAGINAS = 100;

/**
 * @param {string} url  caminho da API, com ou sem query (sem page/limit)
 * @param {RequestInit} [init]
 * @returns {Promise<object[]>} todos os itens de `data`
 * @throws Error com `status` quando alguma pagina responde erro
 */
export async function buscarTodasPaginas(url, init = {}, limite = TAMANHO_PAGINA) {
  const itens = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const separador = url.includes('?') ? '&' : '?';
    const resp = await fetch(`${url}${separador}page=${pagina}&limit=${limite}`, init);
    if (!resp.ok) {
      const erro = new Error(`API respondeu ${resp.status}`);
      erro.status = resp.status;
      throw erro;
    }
    const corpo = await resp.json();
    if (Array.isArray(corpo?.data)) itens.push(...corpo.data);
    totalPaginas = Number(corpo?.pagination?.pages) || 1;
    pagina += 1;
  } while (pagina <= totalPaginas && pagina <= MAX_PAGINAS);
  return itens;
}
