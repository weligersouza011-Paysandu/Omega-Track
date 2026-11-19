// Isolamento por contrato: quem nao e Master so enxerga/grava no proprio
// contrato; Master escolhe (?contrato=010 | todos) e, por padrao, ve o proprio.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const U = (id, nome, matricula, contrato, extra = {}) => ({
  id: `00000000-0000-4000-8000-0000000000${id}`, nome, matricula, contrato, funcao: 'X',
  tipo: 'ADMINISTRADOR', nivel: 'NORMAL', setor: 'TRANSPORTE', ...extra,
});
const NORMAL_251 = U('01', 'Normal 251', '1001', '251');
const MASTER_251 = U('02', 'Master 251', '1002', '251', { nivel: 'MASTER', setor: 'GESTAO' });
const OPERA_010 = U('03', 'Operador 010', '1003', '010', { tipo: 'OPERACIONAL', nivel: null, setor: null });
const OUTRO_010 = U('04', 'Normal 010', '1004', '010');
const USUARIOS = [NORMAL_251, MASTER_251, OPERA_010, OUTRO_010];

const VEICULOS = [
  { tag: 'A1', placa: 'AAA1A11', contrato: '251', status: 'Mobilizado', deletado_em: null, created_at: new Date(1) },
  { tag: 'A2', placa: 'AAA1A12', contrato: '251', status: 'Mobilizado', deletado_em: null, created_at: new Date(2) },
  { tag: 'B1', placa: 'BBB1B11', contrato: '010', status: 'Mobilizado', deletado_em: null, created_at: new Date(3) },
];
const OBRAS = [
  { id: '11111111-1111-4111-8111-111111111111', nome: 'Obra 251', contrato: '251', ativo: true, created_at: new Date(1) },
  { id: '22222222-2222-4222-8222-222222222222', nome: 'Obra 010', contrato: '010', ativo: true, created_at: new Date(2) },
];

const atende = (registro, where = {}) => Object.entries(where).every(([campo, cond]) => {
  if (['deletado_em', 'ativo', 'status'].includes(campo)) return cond === undefined || registro[campo] === cond;
  if (campo === 'contrato') return cond === undefined || registro.contrato === cond;
  if (campo === 'tag' || campo === 'id') return cond === undefined || typeof cond === 'object' ? true : registro[campo] === cond;
  return true;
});

const criados = [];
globalThis.prisma = {
  usuario: {
    findUnique: async ({ where, select }) => {
      const u = USUARIOS.find((x) => x.id === where.id || x.matricula === where.matricula) || null;
      return u && select ? Object.fromEntries(Object.keys(select).map((k) => [k, u[k]])) : u;
    },
    findFirst: async () => null,
    findMany: async ({ where = {}, select } = {}) => USUARIOS.filter((u) => atende(u, where)).map((u) => (select
      ? Object.fromEntries(Object.keys(select).map((k) => [k, u[k]])) : { ...u })),
    groupBy: async ({ where = {} }) => {
      const grupos = new Map();
      for (const u of USUARIOS.filter((x) => atende(x, where))) {
        const chave = `${u.contrato}|${u.tipo}`;
        grupos.set(chave, { contrato: u.contrato, tipo: u.tipo, _count: { _all: (grupos.get(chave)?._count._all || 0) + 1 } });
      }
      return [...grupos.values()];
    },
  },
  logAtividade: { create: async () => ({}) },
  veiculoTerceiro: { findUnique: async () => null },
  mobDesmob: {
    findMany: async ({ where = {} } = {}) => VEICULOS.filter((v) => atende(v, where)),
    count: async ({ where = {} } = {}) => VEICULOS.filter((v) => atende(v, where)).length,
    groupBy: async () => [...new Set(VEICULOS.map((v) => v.contrato))].map((contrato) => ({ contrato })),
    findFirst: async ({ where = {}, include } = {}) => {
      const tag = typeof where.tag === 'object' ? where.tag.equals : where.tag;
      const v = VEICULOS.find((x) => x.tag.toLowerCase() === String(tag).toLowerCase() && atende(x, { ...where, tag: undefined })) || null;
      return v && include ? { ...v, documentacoes: [], partes_diarias: [] } : v;
    },
    create: async ({ data }) => { criados.push(data); return { ...data }; },
  },
  obra: {
    findMany: async ({ where = {} } = {}) => OBRAS.filter((o) => atende(o, where)),
    count: async ({ where = {} } = {}) => OBRAS.filter((o) => atende(o, where)).length,
    findUnique: async ({ where }) => OBRAS.find((o) => o.id === where.id) || null,
  },
};

const { default: app } = await import('../src/app.js');
const { assinarSessao } = await import('../src/middleware/sessao.js');

let servidor;
let base;
before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});
after(() => new Promise((r) => servidor.close(r)));

const chamar = async (usuario, metodo, caminho, corpo) => {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${assinarSessao(usuario)}` },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const tags = (r) => r.corpo.data.map((v) => v.tag).sort();

test('nao-Master so ve a frota do proprio contrato e o parametro ?contrato= e ignorado', async () => {
  assert.deepEqual(tags(await chamar(NORMAL_251, 'GET', '/mob-desmob')), ['A1', 'A2']);
  assert.deepEqual(tags(await chamar(NORMAL_251, 'GET', '/mob-desmob?contrato=010')), ['A1', 'A2']);
  assert.deepEqual(tags(await chamar(NORMAL_251, 'GET', '/mob-desmob?contrato=todos')), ['A1', 'A2']);
  assert.deepEqual(tags(await chamar(OPERA_010, 'GET', '/mob-desmob')), ['B1']);
});

test('veiculo de outro contrato responde 404 por TAG, placa e rotas filhas', async () => {
  assert.equal((await chamar(NORMAL_251, 'GET', '/mob-desmob/tag/A1')).status, 200);
  assert.equal((await chamar(NORMAL_251, 'GET', '/mob-desmob/tag/B1')).status, 404);
  assert.equal((await chamar(NORMAL_251, 'GET', '/mob-desmob/placa/BBB1B11')).status, 404);
  assert.equal((await chamar(NORMAL_251, 'PUT', '/mob-desmob/B1', { modelo: 'X' })).status, 404);
  assert.equal((await chamar(NORMAL_251, 'GET', '/mob-desmob/B1/status-manutencao')).status, 404);
});

test('Master: padrao = o proprio contrato; escolhe 010 ou todos; acessa qualquer TAG', async () => {
  assert.deepEqual(tags(await chamar(MASTER_251, 'GET', '/mob-desmob')), ['A1', 'A2']);
  assert.deepEqual(tags(await chamar(MASTER_251, 'GET', '/mob-desmob?contrato=010')), ['B1']);
  assert.deepEqual(tags(await chamar(MASTER_251, 'GET', '/mob-desmob?contrato=todos')), ['A1', 'A2', 'B1']);
  assert.equal((await chamar(MASTER_251, 'GET', '/mob-desmob/tag/B1')).status, 200);
});

test('obras: lista do contrato e 404 para obra de outro contrato', async () => {
  const lista = await chamar(NORMAL_251, 'GET', '/obras');
  assert.deepEqual(lista.corpo.data.map((o) => o.nome), ['Obra 251']);
  assert.equal((await chamar(NORMAL_251, 'GET', `/obras/${OBRAS[1].id}`)).status, 404);
  assert.equal((await chamar(NORMAL_251, 'GET', `/obras/${OBRAS[0].id}`)).status, 200);
  assert.equal((await chamar(MASTER_251, 'GET', `/obras/${OBRAS[1].id}`)).status, 200);
});

test('usuarios: lista e edicao respeitam o contrato; resumo por contrato', async () => {
  const lista = await chamar(NORMAL_251, 'GET', '/usuarios');
  assert.deepEqual(lista.corpo.data.map((u) => u.matricula).sort(), ['1001', '1002']);
  assert.equal((await chamar(NORMAL_251, 'PUT', `/usuarios/${OUTRO_010.id}`, { nome: 'X' })).status, 404);

  const proprio = await chamar(NORMAL_251, 'GET', '/usuarios/resumo-contratos');
  assert.deepEqual(proprio.corpo.data, [{ contrato: '251', administradores: 2, operacionais: 0, total: 2 }]);
  const todos = await chamar(MASTER_251, 'GET', '/usuarios/resumo-contratos');
  assert.deepEqual(todos.corpo.data.map((l) => [l.contrato, l.total]), [['010', 2], ['251', 2]]);
  assert.equal(todos.corpo.total, 4);
});

test('GET /contratos: nao-Master recebe so o proprio; Master recebe todos', async () => {
  const normal = await chamar(NORMAL_251, 'GET', '/contratos');
  assert.deepEqual(normal.corpo, { data: ['251'], meu: '251', master: false });
  const master = await chamar(MASTER_251, 'GET', '/contratos');
  assert.deepEqual(master.corpo.data, ['010', '251']);
  assert.equal(master.corpo.master, true);
});

test('cadastro de veiculo: grava o contrato do usuario; outro contrato so o Master', async () => {
  const veiculo = (extra = {}) => ({
    tag: 'N1', placa: 'NNN1N11', modelo: 'Van', status: 'Mobilizado', data_mob: '2026-11-01', ...extra,
  });
  const ok = await chamar(NORMAL_251, 'POST', '/mob-desmob', veiculo());
  assert.equal(ok.status, 201);
  assert.equal(criados.at(-1).contrato, '251');
  assert.equal((await chamar(NORMAL_251, 'POST', '/mob-desmob', veiculo({ contrato: '010' }))).status, 403);
  assert.equal((await chamar(NORMAL_251, 'POST', '/mob-desmob', veiculo({ tag: 'N 2' }))).status, 400); // TAG com espaco

  assert.equal((await chamar(MASTER_251, 'POST', '/mob-desmob', veiculo({ contrato: '010' }))).status, 201);
  assert.equal(criados.at(-1).contrato, '010');
  // Master no filtro "Todos" precisa escolher o contrato.
  assert.equal((await chamar(MASTER_251, 'POST', '/mob-desmob?contrato=todos', veiculo())).status, 400);
});
