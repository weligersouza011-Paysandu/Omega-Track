// buscarTodasPaginas: junta todas as paginas da API (antes as telas liam so 200 itens).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buscarTodasPaginas } from '../src/utils/paginas.js';

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
