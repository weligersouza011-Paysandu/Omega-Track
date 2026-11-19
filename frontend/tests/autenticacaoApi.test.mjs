// O fetch global anexa o token da sessao nas chamadas para /api/ (a API exige login).
import assert from 'node:assert/strict';
import { test } from 'node:test';

const chamadas = [];
const armazem = new Map([['omegatrack_sessao', JSON.stringify({ token: 'TOKEN123', usuario: { matricula: '1' } })]]);
globalThis.localStorage = {
  getItem: (k) => armazem.get(k) ?? null,
  setItem: (k, v) => armazem.set(k, v),
  removeItem: (k) => armazem.delete(k),
};
globalThis.window = {
  location: { origin: 'http://app.test' },
  fetch: async (input, init) => { chamadas.push({ input, init }); return { ok: true }; },
};
globalThis.window.fetch.bind = () => globalThis.window.fetch;

const { instalarAutenticacaoApi } = await import('../src/utils/sessao.js');
instalarAutenticacaoApi();

const auth = (i) => new Headers(chamadas[i].init?.headers).get('Authorization');

test('anexa o token em /api/ quando a chamada nao traz Authorization', async () => {
  await window.fetch('/api/mob-desmob?limit=200');
  await window.fetch('/api/obras', { headers: { 'Content-Type': 'application/json' } });
  assert.equal(auth(0), 'Bearer TOKEN123');
  assert.equal(auth(1), 'Bearer TOKEN123');
  assert.equal(new Headers(chamadas[1].init.headers).get('Content-Type'), 'application/json');
});

test('nao sobrescreve Authorization existente nem toca em outras origens/rotas', async () => {
  await window.fetch('/api/obras', { headers: { Authorization: 'Bearer OUTRO' } });
  await window.fetch('https://cdn.exemplo.com/api/x');
  await window.fetch('/assets/logo.png');
  assert.equal(auth(2), 'Bearer OUTRO');
  assert.equal(auth(3), null);
  assert.equal(auth(4), null);
});

test('sem sessao nao inventa token', async () => {
  armazem.clear();
  await window.fetch('/api/obras');
  assert.equal(auth(5), null);
});
