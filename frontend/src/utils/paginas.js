// ============================================================================
// Busca TODAS as paginas de uma listagem (a API limita cada pagina). Antes as
// telas pediam `?limit=200` e ignoravam o resto: com mais de 200 veiculos (ou
// varios contratos no filtro "Todos") parte dos dados sumia sem aviso.
// ============================================================================
import { lerContratoSelecionado } from './contrato.js';

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

// ---------------------------------------------------------------------------
// Cache curto das listas completas: uma tela costuma pedir a mesma frota/obras que a
// anterior acabou de baixar (e varios componentes pedem juntos). A chamada em andamento
// e compartilhada e o resultado vale poucos segundos. Qualquer escrita (POST/PUT/PATCH/
// DELETE em /api) limpa o cache (ver utils/sessao.js), entao a tela nunca mostra lista velha
// depois de salvar. A chave inclui o contrato exibido (filtro do Master).
// ---------------------------------------------------------------------------
const TTL_LISTA_MS = 20000;
const listas = new Map(); // chave -> { quando, promessa }

export function limparCachePaginas() {
  listas.clear();
}

export function buscarTodasPaginasComCache(url, init = {}, { ttlMs = TTL_LISTA_MS } = {}) {
  // O contrato exibido (filtro do Master) muda o resultado: faz parte da chave.
  const chave = `${url}|${lerContratoSelecionado()}`;
  const agora = Date.now();
  const existente = listas.get(chave);
  if (existente && agora - existente.quando < ttlMs) return existente.promessa.then((itens) => [...itens]);
  const promessa = buscarTodasPaginas(url, init).catch((erro) => {
    listas.delete(chave); // nao guarda falha
    throw erro;
  });
  listas.set(chave, { quando: agora, promessa });
  return promessa.then((itens) => [...itens]);
}
