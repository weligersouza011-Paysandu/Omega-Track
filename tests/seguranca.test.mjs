// Seguranca de acesso: as rotas de dados exigem login (JWT) e o header legado
// x-acting-matricula NAO autentica mais ninguem.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const MASTER = { id: '00000000-0000-4000-8000-000000000001', nome: 'Master', funcao: 'Gestor', matricula: '90000', tipo: 'ADMINISTRADOR', nivel: 'MASTER', setor: 'GESTAO', contrato: '251', assinatura_url: 'https://x/assinatura.png' };
const OPERADOR = { id: '00000000-0000-4000-8000-000000000002', nome: 'Op', funcao: 'Motorista', matricula: '777', tipo: 'OPERACIONAL', nivel: null, setor: null, contrato: '251', assinatura_url: 'https://x/op.png' };
const USUARIOS = [MASTER, OPERADOR];

globalThis.prisma = {
  usuario: {
    findUnique: async ({ where }) => USUARIOS.find((u) => u.id === where.id || u.matricula === where.matricula) || null,
    // O que o fallback antigo faria: achar o Master pela matricula do header.
    findFirst: async ({ where }) => USUARIOS.find((u) => u.matricula === where?.matricula) || null,
    findMany: async ({ select } = {}) => USUARIOS.map((u) => (select
      ? Object.fromEntries(Object.keys(select).map((k) => [k, u[k]]))
      : { ...u, senha_hash: 'x' })),
  },
  logAtividade: { create: async () => ({}) },
  mobDesmob: { findMany: async () => [], count: async () => 0 },
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

const chamar = (metodo, caminho, headers = {}) => fetch(`${base}${caminho}`, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: metodo === 'GET' ? undefined : '{}',
}).then(async (r) => ({ status: r.status, corpo: await r.json().catch(() => null) }));

const ROTAS_PROTEGIDAS = [
  ['GET', '/mob-desmob'], ['GET', '/mob-desmob/tag/CA0388'], ['GET', '/mob-desmob/placa/AAA1B23'],
  ['POST', '/mob-desmob'], ['PUT', '/mob-desmob/CA0388'], ['PATCH', '/mob-desmob/CA0388'],
  ['GET', '/documentacao-veiculos'], ['GET', '/documentacao-veiculos/farol'], ['POST', '/documentacao-veiculos'],
  ['GET', '/obras'], ['GET', '/manutencao/projecao-frota'],
  ['GET', '/parametros-preventiva'], ['GET', '/categorias-desvio'],
  ['GET', '/usuarios'], ['PUT', '/usuarios/x'], ['DELETE', '/usuarios/x'], ['POST', '/usuarios/lote'],
  ['GET', '/partes-diarias'], ['GET', '/partes-diarias/pendencias'], ['POST', '/partes-diarias'], ['PUT', '/partes-diarias/x'],
  ['POST', '/upload'], ['DELETE', '/upload'],
];

test('sem login, nenhuma rota de dados responde (401)', async () => {
  for (const [metodo, caminho] of ROTAS_PROTEGIDAS) {
    const r = await chamar(metodo, caminho);
    assert.equal(r.status, 401, `${metodo} ${caminho}`);
  }
});

test('conhecer a matricula de um Master (x-acting-matricula) nao autentica', async () => {
  const falso = { 'x-acting-matricula': MASTER.matricula, 'x-acting-nome': 'Master' };
  for (const [metodo, caminho] of [...ROTAS_PROTEGIDAS, ['GET', '/eficiencia'], ['GET', '/telemetria'], ['GET', '/ecogestao/residuos']]) {
    const r = await chamar(metodo, caminho, falso);
    assert.equal(r.status, 401, `${metodo} ${caminho}`);
  }
});

test('operacional logado le a frota e a lista de pessoas, sem dados sensiveis e sem escrever', async () => {
  const op = { Authorization: `Bearer ${assinarSessao(OPERADOR)}` };
  assert.equal((await chamar('GET', '/mob-desmob', op)).status, 200);

  const lista = await chamar('GET', '/usuarios', op);
  assert.equal(lista.status, 200);
  for (const u of lista.corpo.data) {
    assert.deepEqual(Object.keys(u).sort(), ['funcao', 'id', 'matricula', 'nome', 'tipo']);
  }

  for (const [metodo, caminho] of [['POST', '/mob-desmob'], ['PUT', '/mob-desmob/CA0388'], ['POST', '/documentacao-veiculos'], ['DELETE', '/usuarios/x']]) {
    const r = await chamar(metodo, caminho, op);
    assert.ok([401, 403].includes(r.status), `${metodo} ${caminho} -> ${r.status}`);
  }
});

test('administrador logado enxerga a lista completa de usuarios (sem senha)', async () => {
  const lista = await chamar('GET', '/usuarios', { Authorization: `Bearer ${assinarSessao(MASTER)}` });
  assert.equal(lista.status, 200);
  assert.ok(lista.corpo.data.every((u) => u.senha_hash === undefined));
  assert.ok(lista.corpo.data.some((u) => u.assinatura_url));
});
