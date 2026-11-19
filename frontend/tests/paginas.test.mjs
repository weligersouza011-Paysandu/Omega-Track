// buscarTodasPaginas: junta todas as paginas da API (antes as telas liam so 200 itens).
import assert from 'node:assert/strict';
import { test } from 'node:test';
const armazem = new Map();
globalThis.localStorage = { getItem: (k) => armazem.get(k) ?? null, setItem: (k, v) => armazem.set(k, v), removeItem: (k) => armazem.delete(k) };
const { buscarTodasPaginas, buscarTodasPaginasComCache, limparCachePaginas } = await import('../src/utils/paginas.js');

function falsoFetch(totalItens, tamanho, { falhaNaPagina = null } = {}) {
  const chamadas = [];
  globalThis.fetch = async (url) => {
    chamadas.push(String(url));
    const q = new URL(String(url), 'http://x').searchParams;
    const pagina = Number(q.get('page'));
    const limite = Number(q.get('limit'));
    if (pagina === falhaNaPagina) return { ok: false, status: 500, json: async () => ({}) };
    const inicio = (pagina - 1) * limite;
    const data = Array.from({ length: Math.max(Math.min(limite, totalItens - inicio), 0) }, (_, i) => ({ n: inicio + i }));
    return { ok: true, status: 200, json: async () => ({ data, pagination: { pages: Math.max(Math.ceil(totalItens / limite), 1) } }) };
  };
  return chamadas;
}

test('junta todas as paginas, na ordem, preservando a query', async () => {
  const chamadas = falsoFetch(450, 200);
  const itens = await buscarTodasPaginas('/api/obras?ativo=true');
  assert.equal(itens.length, 450);
  assert.deepEqual(itens.map((i) => i.n).slice(198, 202), [198, 199, 200, 201]);
  assert.deepEqual(chamadas, [
    '/api/obras?ativo=true&page=1&limit=200',
    '/api/obras?ativo=true&page=2&limit=200',
    '/api/obras?ativo=true&page=3&limit=200',
  ]);
});

test('lista vazia = uma chamada; erro em qualquer pagina interrompe com o status', async () => {
  const chamadas = falsoFetch(0, 200);
  assert.deepEqual(await buscarTodasPaginas('/api/mob-desmob'), []);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0], '/api/mob-desmob?page=1&limit=200');

  falsoFetch(500, 200, { falhaNaPagina: 2 });
  await assert.rejects(buscarTodasPaginas('/api/mob-desmob'), (erro) => erro.status === 500);
});

test('cache: chamadas simultaneas compartilham a requisicao e o resultado vale por um tempo', async () => {
  limparCachePaginas();
  const chamadas = falsoFetch(5, 200);
  const [a, b] = await Promise.all([buscarTodasPaginasComCache('/api/mob-desmob'), buscarTodasPaginasComCache('/api/mob-desmob')]);
  assert.equal(a.length, 5);
  assert.equal(chamadas.length, 1, 'duas telas pedindo juntas = uma so requisicao');
  a.push({ n: 999 }); // quem recebe pode alterar a propria copia
  assert.equal((await buscarTodasPaginasComCache('/api/mob-desmob')).length, 5);
  assert.equal(chamadas.length, 1, 'dentro do prazo nao busca de novo');
  limparCachePaginas(); // o que uma escrita faz
  await buscarTodasPaginasComCache('/api/mob-desmob');
  assert.equal(chamadas.length, 2);
});

test('cache: o contrato exibido separa os resultados e falha nao fica guardada', async () => {
  limparCachePaginas();
  const chamadas = falsoFetch(3, 200);
  armazem.delete('omegatrack_contrato_filtro');
  await buscarTodasPaginasComCache('/api/obras');
  armazem.set('omegatrack_contrato_filtro', '010');
  await buscarTodasPaginasComCache('/api/obras');
  assert.equal(chamadas.length, 2, 'outro contrato = outra lista');
  armazem.delete('omegatrack_contrato_filtro');

  limparCachePaginas();
  falsoFetch(500, 200, { falhaNaPagina: 1 });
  await assert.rejects(buscarTodasPaginasComCache('/api/vazia'), (e) => e.status === 500);
  const chamadasDepois = falsoFetch(2, 200);
  assert.equal((await buscarTodasPaginasComCache('/api/vazia')).length, 2);
  assert.equal(chamadasDepois.length, 1, 'a falha anterior nao ficou em cache');
});
