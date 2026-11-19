// Visibilidade por setor: Meio Ambiente enxerga so os modulos ambientais e a
// mobilizacao essencial da frota; Transporte acompanha os ambientais em leitura.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const U = (id, setor, extra = {}) => ({
  id: `00000000-0000-4000-8000-0000000000${id}`, nome: setor, matricula: `20${id}`, contrato: '251', funcao: 'X',
  tipo: 'ADMINISTRADOR', nivel: 'NORMAL', setor, ...extra,
});
const AMBIENTE = U('01', 'MEIO_AMBIENTE');
const TRANSPORTE = U('02', 'TRANSPORTE');
const GESTAO = U('03', 'GESTAO');
const PLANEJADOR = U('04', 'PLANEJADOR');
const MASTER_AMBIENTE = U('05', 'MEIO_AMBIENTE', { nivel: 'MASTER' });
const USUARIOS = [AMBIENTE, TRANSPORTE, GESTAO, PLANEJADOR, MASTER_AMBIENTE];

const VEICULO = {
  tag: 'A1', placa: 'AAA1A11', modelo: 'Van', contrato: '251', status: 'Mobilizado', deletado_em: null,
  data_mob: new Date('2026-01-10'), data_desmob: null, combustivel: 'Diesel S10', foto_veiculo: null,
  chassi: 'CH123', renavam: 'RN123', cor: 'Branca', km_inicial: 100, km_limite_preventiva: 10000, km_ultima_preventiva: 500,
};
const projetar = (registro, select) => (select
  ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, registro[k]]))
  : { ...registro, _count: { documentacoes: 1, partes_diarias: 2 }, documentacoes: [], partes_diarias: [] });

const atualizacoes = [];
globalThis.prisma = {
  usuario: { findUnique: async ({ where }) => USUARIOS.find((u) => u.id === where.id) || null, findFirst: async () => null },
  logAtividade: { create: async () => ({}) },
  mobDesmob: {
    findMany: async ({ select } = {}) => [projetar(VEICULO, select)],
    count: async () => 1,
    findFirst: async ({ select } = {}) => projetar(VEICULO, select),
    update: async ({ data }) => { atualizacoes.push(data); return { ...VEICULO, ...data }; },
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

const chamar = async (usuario, metodo, caminho, corpo = {}) => {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${assinarSessao(usuario)}` },
    body: metodo === 'GET' ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

test('Meio Ambiente nao acessa os modulos de transporte', async () => {
  for (const [metodo, caminho] of [
    ['GET', '/partes-diarias'], ['GET', '/partes-diarias/pendencias'], ['GET', '/programacao-recursos?data=2026-11-18'],
    ['GET', '/veiculos-terceiros'], ['GET', '/eficiencia'], ['GET', '/telemetria'], ['GET', '/obras'],
    ['GET', '/documentacao-veiculos'], ['GET', '/manutencao/projecao-frota'], ['GET', '/parametros-preventiva'],
    ['GET', '/categorias-desvio'], ['POST', '/partes-diarias'],
  ]) {
    assert.equal((await chamar(AMBIENTE, metodo, caminho)).status, 403, `${metodo} ${caminho}`);
  }
});

test('Meio Ambiente ve a mobilizacao so com as informacoes essenciais', async () => {
  const lista = await chamar(AMBIENTE, 'GET', '/mob-desmob');
  assert.equal(lista.status, 200);
  assert.deepEqual(Object.keys(lista.corpo.data[0]).sort(),
    ['combustivel', 'contrato', 'data_desmob', 'data_mob', 'foto_veiculo', 'modelo', 'placa', 'status', 'tag']);
  const ficha = await chamar(AMBIENTE, 'GET', '/mob-desmob/tag/A1');
  assert.equal(ficha.status, 200);
  assert.equal(ficha.corpo.data.chassi, undefined);
  assert.equal(ficha.corpo.data.documentacoes, undefined);
  // Quem tem visao completa continua vendo tudo.
  const completa = await chamar(TRANSPORTE, 'GET', '/mob-desmob/tag/A1');
  assert.equal(completa.corpo.data.chassi, 'CH123');
  assert.ok(Array.isArray(completa.corpo.data.documentacoes));
});

test('Meio Ambiente corrige apenas o combustivel do veiculo', async () => {
  const ok = await chamar(AMBIENTE, 'PATCH', '/mob-desmob/A1', { combustivel: 'Etanol' });
  assert.equal(ok.status, 200);
  assert.equal(atualizacoes.at(-1).combustivel, 'Etanol');
  assert.equal(atualizacoes.length, 1);
  for (const corpo of [{ chassi: 'X' }, { combustivel: 'Etanol', cor: 'Preta' }, { km_inicial: 5 }]) {
    assert.equal((await chamar(AMBIENTE, 'PATCH', '/mob-desmob/A1', corpo)).status, 403, JSON.stringify(corpo));
  }
  for (const [metodo, caminho] of [
    ['POST', '/mob-desmob'], ['PUT', '/mob-desmob/A1'], ['PUT', '/mob-desmob/A1/desmobilizar'],
    ['POST', '/mob-desmob/A1/preventiva'], ['POST', '/mob-desmob/A1/foto'], ['DELETE', '/mob-desmob/A1'],
    ['GET', '/mob-desmob/A1/status-manutencao'], ['GET', '/mob-desmob/placa/AAA1A11/telemetria'],
  ]) {
    assert.equal((await chamar(AMBIENTE, metodo, caminho)).status, 403, `${metodo} ${caminho}`);
  }
  assert.equal(atualizacoes.length, 1);
});

test('Transporte acompanha os modulos ambientais somente em leitura', async () => {
  for (const [metodo, caminho] of [
    ['POST', '/ecogestao/residuos'], ['PUT', '/ecogestao/residuos/x'], ['DELETE', '/ecogestao/residuos/x'],
    ['POST', '/ecogestao/agua/importar'], ['POST', '/ecogestao/atos'], ['DELETE', '/ecogestao/atos/x'],
    ['POST', '/ecogestao/produtos-quimicos/excluir-lote'], ['POST', '/abastecimentos/importar'],
  ]) {
    assert.equal((await chamar(TRANSPORTE, metodo, caminho)).status, 403, `${metodo} ${caminho}`);
  }
});

test('Meio Ambiente, Gestao e Planejador escrevem nos modulos ambientais (nao tomam 403 de setor)', async () => {
  for (const usuario of [AMBIENTE, GESTAO, PLANEJADOR, MASTER_AMBIENTE]) {
    // Corpo vazio: a validacao do controller responde 400, sem chegar ao banco.
    const r = await chamar(usuario, 'POST', '/ecogestao/residuos');
    assert.notEqual(r.status, 403, usuario.setor);
  }
});

test('Gestao, Planejador e Master de qualquer setor nao sao barrados nos modulos de transporte', async () => {
  for (const usuario of [GESTAO, PLANEJADOR, MASTER_AMBIENTE, TRANSPORTE]) {
    const r = await chamar(usuario, 'GET', '/mob-desmob');
    assert.equal(r.status, 200, usuario.setor);
    assert.ok('chassi' in r.corpo.data[0] || r.corpo.data[0]._count, usuario.setor);
  }
  assert.notEqual((await chamar(PLANEJADOR, 'GET', '/documentacao-veiculos')).status, 403);
  assert.notEqual((await chamar(MASTER_AMBIENTE, 'GET', '/documentacao-veiculos')).status, 403);
});
