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

const logar = (usuario) => armazem.set('omegatrack_sessao', JSON.stringify({ token: 'TOKEN123', usuario }));
const urlDe = (i) => String(chamadas[i].input);

test('Master com contrato escolhido: o filtro vai em toda chamada /api (menos login/contratos/upload)', async () => {
  logar({ matricula: '1', tipo: 'ADMINISTRADOR', nivel: 'MASTER' });
  armazem.set('omegatrack_contrato_filtro', '010');
  const antes = chamadas.length;
  await window.fetch('/api/mob-desmob?limit=200');
  await window.fetch('/api/obras');
  await window.fetch('/api/obras?contrato=todos');      // parametro proprio da tela prevalece
  await window.fetch('/api/contratos');
  await window.fetch('/api/login/eu');
  await window.fetch('/api/obras', { method: 'POST', body: '{}' });
  assert.equal(urlDe(antes), '/api/mob-desmob?limit=200&contrato=010');
  assert.equal(urlDe(antes + 1), '/api/obras?contrato=010');
  assert.equal(urlDe(antes + 2), '/api/obras?contrato=todos');
  assert.equal(urlDe(antes + 3), '/api/contratos');
  assert.equal(urlDe(antes + 4), '/api/login/eu');
  assert.equal(urlDe(antes + 5), '/api/obras?contrato=010');
  assert.equal(new Headers(chamadas[antes].init.headers).get('Authorization'), 'Bearer TOKEN123');
});

test('Nao-Master e Master sem escolha nao recebem o parametro', async () => {
  const antes = chamadas.length;
  logar({ matricula: '2', tipo: 'ADMINISTRADOR', nivel: 'NORMAL' });
  armazem.set('omegatrack_contrato_filtro', '010');
  await window.fetch('/api/obras');
  logar({ matricula: '1', tipo: 'ADMINISTRADOR', nivel: 'MASTER' });
  armazem.delete('omegatrack_contrato_filtro');
  await window.fetch('/api/obras');
  assert.equal(urlDe(antes), '/api/obras');
  assert.equal(urlDe(antes + 1), '/api/obras');
});
