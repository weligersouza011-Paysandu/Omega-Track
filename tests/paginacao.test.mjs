// Paginacao: teto de itens por pagina e metadados consistentes nas listagens.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { lerPaginacao, blocoPaginacao, LIMITE_MAXIMO_PADRAO } from '../src/utils/paginacao.js';

const ADMIN = { id: '00000000-0000-4000-8000-000000000001', nome: 'A', matricula: '1', contrato: '251', tipo: 'ADMINISTRADOR', nivel: 'NORMAL', setor: 'TRANSPORTE' };
const consultas = [];
const VEICULOS = Array.from({ length: 7 }, (_, i) => ({ tag: `V${i}`, placa: `AAA${i}A00`, contrato: '251', status: 'Mobilizado', created_at: new Date(i) }));

globalThis.prisma = {
  usuario: { findUnique: async ({ where }) => (where.id === ADMIN.id ? ADMIN : null), findFirst: async () => null },
  logAtividade: { create: async () => ({}) },
  mobDesmob: {
    findMany: async (args) => { consultas.push(args); return VEICULOS.slice(args.skip, args.skip + args.take); },
    count: async () => VEICULOS.length,
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

const obter = (caminho) => fetch(`${base}${caminho}`, { headers: { Authorization: `Bearer ${assinarSessao(ADMIN)}` } }).then((r) => r.json());

test('lerPaginacao: padrao, teto e pagina minima', () => {
  assert.deepEqual(lerPaginacao({}), { page: 1, limit: 50, skip: 0 });
  assert.deepEqual(lerPaginacao({ page: '3', limit: '20' }), { page: 3, limit: 20, skip: 40 });
  assert.equal(lerPaginacao({ limit: '1000000' }).limit, LIMITE_MAXIMO_PADRAO);
  assert.deepEqual(lerPaginacao({ page: '0', limit: '-5' }), { page: 1, limit: 50, skip: 0 });
  assert.deepEqual(lerPaginacao({ page: 'x', limit: 'y' }, { padrao: 100 }), { page: 1, limit: 100, skip: 0 });
  assert.deepEqual(blocoPaginacao({ page: 1, limit: 50 }, 0), { page: 1, limit: 50, total: 0, pages: 1 });
  assert.deepEqual(blocoPaginacao({ page: 1, limit: 3 }, 7), { page: 1, limit: 3, total: 7, pages: 3 });
});

test('frota: teto de itens por pagina e paginas consecutivas cobrem tudo sem repetir', async () => {
  await obter('/mob-desmob?limit=999999');
  assert.equal(consultas.at(-1).take, LIMITE_MAXIMO_PADRAO, 'sem teto, ?limit= leria a tabela inteira');

  const vistos = [];
  let pagina = 1;
  let paginas = 1;
  do {
    const corpo = await obter(`/mob-desmob?limit=3&page=${pagina}`);
    vistos.push(...corpo.data.map((v) => v.tag));
    paginas = corpo.pagination.pages;
    pagina += 1;
  } while (pagina <= paginas);
  assert.equal(paginas, 3);
  assert.deepEqual(vistos, VEICULOS.map((v) => v.tag));
});
