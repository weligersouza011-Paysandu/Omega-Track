// Contrato em que cada lancamento/importacao sera gravado (filtro do topo para o Master).
import assert from 'node:assert/strict';
import { test } from 'node:test';

const armazem = new Map();
globalThis.localStorage = {
  getItem: (k) => armazem.get(k) ?? null,
  setItem: (k, v) => armazem.set(k, v),
  removeItem: (k) => armazem.delete(k),
};
const { contratoDeLancamento, salvarContratoSelecionado } = await import('../src/utils/contrato.js');

const master = { tipo: 'ADMINISTRADOR', nivel: 'MASTER', contrato: '251' };
const normal = { tipo: 'ADMINISTRADOR', nivel: 'NORMAL', contrato: '251' };

test('nao-Master sempre lanca no proprio contrato, ignorando o filtro', () => {
  salvarContratoSelecionado('010');
  assert.equal(contratoDeLancamento(normal), '251');
  salvarContratoSelecionado('todos');
  assert.equal(contratoDeLancamento(normal), '251');
});

test('Master segue o filtro; sem escolha usa o proprio; em Todos precisa escolher', () => {
  salvarContratoSelecionado('');
  assert.equal(contratoDeLancamento(master), '251');
  salvarContratoSelecionado('010');
  assert.equal(contratoDeLancamento(master), '010');
  salvarContratoSelecionado('todos');
  assert.equal(contratoDeLancamento(master), null);
  assert.equal(contratoDeLancamento(null), null);
});
