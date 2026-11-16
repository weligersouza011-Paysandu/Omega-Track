// Veículos Terceiros: CRUD pela API real com um Prisma mínimo em memória.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';

const ADMIN = { id: '00000000-0000-4000-8000-000000000001', nome: 'Gestor', matricula: '90000', tipo: 'ADMINISTRADOR', nivel: 'MASTER', setor: 'GESTAO' };
const frota = new Map([['JI439', { tag: 'JI439' }]]);
const terceiros = new Map();
const porTag = (tag) => [...terceiros.values()].find((v) => v.tag === tag) || null;

globalThis.prisma = {
  usuario: {
    findUnique: async ({ where }) => (where.id === ADMIN.id ? ADMIN : null),
    findFirst: async () => ADMIN,
  },
  logAtividade: { create: async () => ({}) },
  mobDesmob: { findUnique: async ({ where }) => frota.get(where.tag) || null },
  veiculoTerceiro: {
    findMany: async () => [...terceiros.values()],
    findUnique: async ({ where }) => (where.id ? terceiros.get(where.id) || null : porTag(where.tag)),
    create: async ({ data }) => {
      const reg = { id: randomUUID(), empresa_terceira: null, placa: null, modelo: null, foto_url: null, observacao: null, created_at: new Date(), ...data };
      terceiros.set(reg.id, reg);
      return reg;
    },
    update: async ({ where, data }) => {
      const reg = { ...terceiros.get(where.id), ...data };
      terceiros.set(where.id, reg);
      return reg;
    },
    delete: async ({ where }) => { const reg = terceiros.get(where.id); terceiros.delete(where.id); return reg; },
  },
};

const { default: app } = await import('../src/app.js');
const { assinarSessao } = await import('../src/middleware/sessao.js');
const TOKEN = assinarSessao(ADMIN);

let base;
let servidor;
before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api/veiculos-terceiros`;
});
after(() => new Promise((r) => servidor.close(r)));

const api = async (caminho, { method = 'GET', body, token = TOKEN } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${caminho}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, corpo: r.status === 204 ? null : await r.json() };
};

test('exige administrador autenticado', async () => {
  assert.equal((await api('/', { token: null })).status, 401);
});

test('cadastro exige TAG e tipo; opcionais ficam nulos', async () => {
  assert.equal((await api('/', { method: 'POST', body: { tipo: 'Caminhonete' } })).status, 400);
  assert.equal((await api('/', { method: 'POST', body: { tag: 'TER-01' } })).status, 400);

  const { status, corpo } = await api('/', { method: 'POST', body: { tag: ' ter-01 ', tipo: 'Caminhão Munck', placa: 'abc1d23', empresa_terceira: '' } });
  assert.equal(status, 201);
  assert.equal(corpo.data.tag, 'TER-01');
  assert.equal(corpo.data.placa, 'ABC1D23');
  assert.equal(corpo.data.empresa_terceira, null);
});

test('TAG não pode repetir nem colidir com a frota própria', async () => {
  assert.equal((await api('/', { method: 'POST', body: { tag: 'TER-01', tipo: 'Caminhonete' } })).status, 409);
  assert.equal((await api('/', { method: 'POST', body: { tag: 'ji439', tipo: 'Caminhonete' } })).status, 409);
});

test('rejeita foto em base64 (somente URL do upload)', async () => {
  const r = await api('/', { method: 'POST', body: { tag: 'TER-02', tipo: 'Van', foto_url: 'data:image/png;base64,AAA' } });
  assert.equal(r.status, 400);
});

test('lista, atualiza e exclui diretamente', async () => {
  const lista = await api('/');
  assert.equal(lista.status, 200);
  assert.equal(lista.corpo.data.length, 1);
  const { id } = lista.corpo.data[0];

  const put = await api(`/${id}`, { method: 'PUT', body: { empresa_terceira: 'Transportes XYZ' } });
  assert.equal(put.status, 200);
  assert.equal(put.corpo.data.empresa_terceira, 'Transportes XYZ');
  assert.equal(put.corpo.data.tipo, 'Caminhão Munck');

  assert.equal((await api(`/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await api(`/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await api('/')).corpo.data.length, 0);
});
