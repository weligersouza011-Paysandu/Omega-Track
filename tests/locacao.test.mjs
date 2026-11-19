// Locacao (Serra Norte / Serra Leste) dentro do contrato: cadastro, indicador e regras de preventiva.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chaveLocacao, limparLocacao, resolverLocacao } from '../src/utils/locacao.js';

const U = (id, nivel, contrato) => ({
  id: `00000000-0000-4000-8000-0000000000${id}`, nome: `U${id}`, matricula: `40${id}`, contrato, funcao: 'X',
  tipo: 'ADMINISTRADOR', nivel, setor: 'TRANSPORTE',
});
const NORMAL_251 = U('01', 'NORMAL', '251');
const MASTER_251 = U('02', 'MASTER', '251');
const NORMAL_010 = U('03', 'NORMAL', '010');
const USUARIOS = [NORMAL_251, MASTER_251, NORMAL_010];

const V = (tag, contrato, locacao, status = 'Mobilizado') => ({ tag, placa: `P-${tag}`, modelo: 'Van', contrato, locacao, status, deletado_em: null, data_mob: new Date('2026-01-01'), data_desmob: null, created_at: new Date() });
let veiculos;
const criados = [];
const regras = [];

const casa = (v, where = {}) => Object.entries(where).every(([k, c]) => {
  if (k === 'contrato') return c === undefined || v.contrato === c;
  if (k === 'deletado_em') return v.deletado_em === c;
  if (k === 'locacao') return c?.not === null ? v.locacao !== null && v.locacao !== undefined : v.locacao === c;
  return true;
});

globalThis.prisma = {
  usuario: { findUnique: async ({ where }) => USUARIOS.find((u) => u.id === where.id) || null, findFirst: async () => null },
  logAtividade: { create: async () => ({}) },
  veiculoTerceiro: { findUnique: async () => null },
  veiculoContratoHistorico: { create: async () => ({}) },
  mobDesmob: {
    groupBy: async ({ by, where }) => {
      const grupos = new Map();
      for (const v of veiculos.filter((x) => casa(x, where))) {
        const chave = by.map((c) => v[c] ?? null).join('|');
        const g = grupos.get(chave) || { ...Object.fromEntries(by.map((c) => [c, v[c] ?? null])), _count: { _all: 0 } };
        g._count._all += 1;
        grupos.set(chave, g);
      }
      return [...grupos.values()];
    },
    create: async ({ data }) => { criados.push(data); veiculos.push({ ...V(data.tag, data.contrato, data.locacao), ...data }); return { ...data }; },
    findFirst: async ({ where }) => {
      const tag = typeof where.tag === 'object' ? where.tag.equals : where.tag;
      return veiculos.find((v) => v.tag.toLowerCase() === String(tag).toLowerCase()) || null;
    },
    update: async ({ where, data }) => Object.assign(veiculos.find((v) => v.tag === where.tag), data),
  },
  parametroPreventiva: {
    findFirst: async ({ where }) => regras.find((r) => r.categoria === where.categoria
      && (where.contrato === undefined || r.contrato === where.contrato)
      && (where.locacao === undefined || r.locacao === where.locacao)) || null,
  },
};
const { default: app } = await import('../src/app.js');
const { assinarSessao } = await import('../src/middleware/sessao.js');
const { resolverLimitePreventiva } = await import('../src/services/manutencaoService.js');

let servidor;
let base;
before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});
after(() => new Promise((r) => servidor.close(r)));

function reiniciar() {
  veiculos = [
    V('A1', '251', 'Serra Norte'), V('A2', '251', 'Serra Norte'), V('A3', '251', 'Serra Leste'),
    V('A4', '251', null), V('A5', '251', 'Serra Norte', 'Desmobilizado'), V('B1', '010', null),
  ];
  criados.length = 0;
}
const chamar = async (usuario, metodo, caminho, corpo) => {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${assinarSessao(usuario)}` },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const veiculo = (extra = {}) => ({ tag: 'N1', placa: 'NNN1N11', modelo: 'Van', status: 'Mobilizado', data_mob: '2026-11-01', ...extra });

test('normalizacao: ignora acento, caixa e espacos; capitaliza nome novo', async () => {
  reiniciar();
  assert.equal(chaveLocacao('  SÉRRA   norte '), 'serra norte');
  assert.equal(limparLocacao('   '), null);
  assert.equal(await resolverLocacao(globalThis.prisma, '251', 'serra  NORTE'), 'Serra Norte', 'reaproveita o nome existente');
  assert.equal(await resolverLocacao(globalThis.prisma, '251', 'serra sul'), 'Serra Sul', 'nome novo vem capitalizado');
  assert.equal(await resolverLocacao(globalThis.prisma, '251', 'Frente CMD'), 'Frente CMD', 'caixa mista e respeitada');
  await assert.rejects(resolverLocacao(globalThis.prisma, '251', 'x'.repeat(61)), /60 caracteres/);
  // Contrato sem locacoes: vazio e aceito; com locacoes e obrigatoria.
  assert.equal(await resolverLocacao(globalThis.prisma, '010', '', { obrigatoria: true }), null);
  await assert.rejects(resolverLocacao(globalThis.prisma, '251', '', { obrigatoria: true }), /Informe a locação/);
});

test('indicador: veiculos por locacao no contrato (e Sem locacao)', async () => {
  reiniciar();
  const r = await chamar(NORMAL_251, 'GET', '/mob-desmob/locacoes');
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.data.map((l) => [l.locacao, l.mobilizados, l.desmobilizados, l.total]), [
    ['Serra Leste', 1, 0, 1], ['Serra Norte', 2, 1, 3], [null, 1, 0, 1],
  ]);
  assert.ok(r.corpo.data.every((l) => l.contrato === '251'), 'nao mistura contratos');
  const outro = await chamar(NORMAL_010, 'GET', '/mob-desmob/locacoes');
  assert.deepEqual(outro.corpo.data.map((l) => [l.contrato, l.locacao]), [['010', null]]);
  const master = await chamar(MASTER_251, 'GET', '/mob-desmob/locacoes?contrato=todos');
  assert.equal(master.corpo.data.length, 4);
});

test('cadastro: locacao obrigatoria no contrato que usa locacoes; reaproveita o nome', async () => {
  reiniciar();
  assert.equal((await chamar(NORMAL_251, 'POST', '/mob-desmob', veiculo())).status, 400);
  const ok = await chamar(NORMAL_251, 'POST', '/mob-desmob', veiculo({ locacao: 'serra leste' }));
  assert.equal(ok.status, 201, JSON.stringify(ok.corpo));
  assert.equal(criados.at(-1).locacao, 'Serra Leste');
  // Contrato sem locacoes: segue sem informar.
  const semLoc = await chamar(NORMAL_010, 'POST', '/mob-desmob', veiculo({ tag: 'N2', placa: 'NNN2N22' }));
  assert.equal(semLoc.status, 201);
  assert.equal(criados.at(-1).locacao, null);
});

test('mudar a locacao do veiculo (PUT) normaliza e nao afeta outras locacoes', async () => {
  reiniciar();
  const r = await chamar(NORMAL_251, 'PUT', '/mob-desmob/A4', { locacao: 'SERRA NORTE' });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(veiculos.find((v) => v.tag === 'A4').locacao, 'Serra Norte');
  assert.equal(veiculos.find((v) => v.tag === 'A3').locacao, 'Serra Leste');
});

test('preventiva: regra da locacao > regra do contrato > global', async () => {
  regras.length = 0;
  regras.push(
    { id: 'r1', categoria: 'VAN', contrato: '251', locacao: 'Serra Norte', km_limite_preventiva: 10000 },
    { id: 'r2', categoria: 'VAN', contrato: '251', locacao: null, km_limite_preventiva: 9000 },
    { id: 'r3', categoria: 'VAN', contrato: null, locacao: null, km_limite_preventiva: 8000 },
  );
  const comum = { categoria: 'van', contrato: '251' };
  assert.deepEqual(await resolverLimitePreventiva({ ...comum, locacao: 'Serra Norte' }), { km_limite: 10000, origem_limite: 'categoria+locacao', parametro_id: 'r1' });
  assert.equal((await resolverLimitePreventiva({ ...comum, locacao: 'Serra Leste' })).origem_limite, 'categoria+contrato');
  assert.equal((await resolverLimitePreventiva({ ...comum, locacao: null })).km_limite, 9000);
  assert.equal((await resolverLimitePreventiva({ categoria: 'van', contrato: '010' })).origem_limite, 'categoria');
});
