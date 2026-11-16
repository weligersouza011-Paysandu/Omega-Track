// ============================================================================
// Armazenamento offline (IndexedDB, sem dependências).
//   api_cache     -> última resposta JSON de cada leitura da API, por usuário
//   offline_queue -> mutações feitas sem rede, em ordem (FIFO)
// Mesma interface em memória para testes e navegadores sem IndexedDB.
// ============================================================================

const NOME_BANCO = 'omegatrack-offline';
const VERSAO_BANCO = 1;
const CACHE = 'api_cache';
const FILA = 'offline_queue';
const VALIDADE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

function promessa(requisicao) {
  return new Promise((resolve, reject) => {
    requisicao.onsuccess = () => resolve(requisicao.result);
    requisicao.onerror = () => reject(requisicao.error);
  });
}

export function criarArmazenamentoIndexedDB(indexedDB = globalThis.indexedDB) {
  let conexao;
  const abrir = () => {
    if (!conexao) {
      conexao = new Promise((resolve, reject) => {
        const req = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: 'chave' });
          if (!db.objectStoreNames.contains(FILA)) db.createObjectStore(FILA, { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { conexao = null; reject(req.error); };
      });
    }
    return conexao;
  };
  const operar = async (loja, modo, fn) => {
    const db = await abrir();
    const tx = db.transaction(loja, modo);
    const resultado = await promessa(fn(tx.objectStore(loja)));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return resultado;
  };

  return {
    lerCache: (chave) => operar(CACHE, 'readonly', (s) => s.get(chave)),
    gravarCache: (registro) => operar(CACHE, 'readwrite', (s) => s.put(registro)),
    limparCache: () => operar(CACHE, 'readwrite', (s) => s.clear()),
    async podarCache(agora = Date.now()) {
      const todos = await operar(CACHE, 'readonly', (s) => s.getAll());
      const vencidos = todos.filter((r) => agora - r.salvoEm > VALIDADE_CACHE_MS);
      for (const r of vencidos) await operar(CACHE, 'readwrite', (s) => s.delete(r.chave));
      return vencidos.length;
    },
    listarFila: () => operar(FILA, 'readonly', (s) => s.getAll()),
    adicionarFila: (item) => operar(FILA, 'readwrite', (s) => s.add(item)),
    atualizarFila: (item) => operar(FILA, 'readwrite', (s) => s.put(item)),
    removerFila: (id) => operar(FILA, 'readwrite', (s) => s.delete(id)),
  };
}

export function criarArmazenamentoMemoria() {
  const cache = new Map();
  const fila = new Map();
  let proximoId = 1;
  return {
    lerCache: async (chave) => cache.get(chave),
    gravarCache: async (registro) => { cache.set(registro.chave, registro); },
    limparCache: async () => { cache.clear(); },
    async podarCache(agora = Date.now()) {
      let removidos = 0;
      for (const [chave, r] of cache) {
        if (agora - r.salvoEm > VALIDADE_CACHE_MS) { cache.delete(chave); removidos += 1; }
      }
      return removidos;
    },
    listarFila: async () => [...fila.values()].sort((a, b) => a.id - b.id).map((item) => ({ ...item })),
    adicionarFila: async (item) => { const id = proximoId++; fila.set(id, { ...item, id }); return id; },
    atualizarFila: async (item) => { fila.set(item.id, { ...item }); },
    removerFila: async (id) => { fila.delete(id); },
  };
}

let padrao;
// Instância única do app (IndexedDB quando existe; memória como último recurso).
export function armazenamentoPadrao() {
  if (!padrao) {
    padrao = typeof globalThis.indexedDB !== 'undefined'
      ? criarArmazenamentoIndexedDB()
      : criarArmazenamentoMemoria();
  }
  return padrao;
}

// Chamado no logout: dados lidos não ficam no computador de uso compartilhado.
// A fila de alterações é preservada (só sincroniza com o mesmo usuário logado).
export async function limparCacheLeituras() {
  try {
    await armazenamentoPadrao().limparCache();
  } catch {
    /* IndexedDB indisponível: nada a limpar */
  }
}
