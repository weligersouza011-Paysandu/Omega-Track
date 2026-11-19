// Programação: 2 motoristas (manhã/tarde) em ônibus/vans e cadastro rápido de
// operador/supervisor, pela API real com um Prisma mínimo em memória.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

const GESTOR = { id: '00000000-0000-4000-8000-000000000001', nome: 'Gestor', matricula: '90000', tipo: 'ADMINISTRADOR', nivel: 'NORMAL', setor: 'GESTAO', contrato: '251' };
const AMBIENTAL = { id: '00000000-0000-4000-8000-000000000002', nome: 'Analista', matricula: '90001', tipo: 'ADMINISTRADOR', nivel: 'NORMAL', setor: 'MEIO_AMBIENTE', contrato: '251' };
const OBRA = '11111111-1111-4111-8111-111111111111';
const TERCEIRO_ID = '22222222-2222-4222-8222-222222222222';
const DATA = '2026-11-16';
const ANTERIOR = new Date('2026-11-13T00:00:00.000Z');

const MASTER_010 = { id: '00000000-0000-4000-8000-000000000003', nome: 'Master', matricula: '90002', tipo: 'ADMINISTRADOR', nivel: 'MASTER', setor: 'GESTAO', contrato: '010' };
let usuarios;
let gravados; // chamadas de escrita na programação
let criadosNoBanco; // data enviada a usuario.create
const pessoa = (matricula, nome) => ({ id: `u-${matricula}`, matricula, nome, funcao: 'Motorista', tipo: 'OPERACIONAL' });

beforeEach(() => {
  usuarios = [GESTOR, AMBIENTAL, MASTER_010, pessoa('100', 'Ana Manhã'), pessoa('101', 'Bruno Tarde'), pessoa('200', 'Carla Supervisora')];
  gravados = [];
  criadosNoBanco = [];
});

const tardeNaOrigem = {
  obra_id: OBRA, operador_matricula: '100', operador_nome: 'Ana Manhã',
  operador_tarde_matricula: '101', operador_tarde_nome: 'Bruno Tarde',
  supervisor_matricula: null, supervisor_nome: null, obra: { ativo: true },
};

const banco = {
  $queryRaw: async () => [],
  usuario: {
    findUnique: async ({ where }) => usuarios.find((u) => (where.id ? u.id === where.id : u.matricula === where.matricula)) || null,
    findFirst: async () => null,
    findMany: async ({ where } = {}) => (where?.matricula?.in
      ? usuarios.filter((u) => where.matricula.in.includes(u.matricula))
      : usuarios),
    create: async ({ data }) => {
      criadosNoBanco.push(data);
      if (usuarios.some((u) => u.matricula === data.matricula)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      const novo = { id: `u-${data.matricula}`, ...data };
      usuarios.push(novo);
      return { id: novo.id, matricula: novo.matricula, nome: novo.nome, funcao: novo.funcao, tipo: novo.tipo };
    },
  },
  logAtividade: { create: async () => ({}) },
  mobDesmob: {
    findMany: async ({ where, select }) => {
      if (select?.programacoes) {
        return [{ tag: 'ON-01', placa: 'ABC1D23', modelo: 'Ônibus', contrato: 'CT', status: 'Mobilizado', foto_veiculo: null,
          programacoes: [{ id: 'p1', updated_at: new Date(), ...tardeNaOrigem }], manutencoes: [] }];
      }
      const frota = ['ON-01'];
      return (where?.tag?.in ? frota.filter((t) => where.tag.in.includes(t)) : frota).map((tag) => ({ tag }));
    },
    count: async ({ where }) => where.tag.in.filter((t) => t === 'ON-01').length,
  },
  veiculoTerceiro: {
    findMany: async ({ where, select }) => {
      if (select?.programacoes) {
        return [{ id: TERCEIRO_ID, tag: 'VAN-T1', tipo: 'Van', empresa_terceira: 'Locadora', placa: null, modelo: 'Sprinter', foto_url: null,
          programacoes: [{ id: 'pt1', updated_at: new Date(), ...tardeNaOrigem }] }];
      }
      return where?.tag?.in?.includes('VAN-T1') || !where ? [{ id: TERCEIRO_ID, tag: 'VAN-T1' }] : [];
    },
    count: async ({ where }) => where.id.in.filter((id) => id === TERCEIRO_ID).length,
  },
  obra: {
    findMany: async ({ where } = {}) => (where?.id?.in
      ? where.id.in.filter((id) => id === OBRA).map((id) => ({ id }))
      : [{ id: OBRA, nome: 'Obra Norte', numero_contrato: null, ativo: true }]),
  },
  manutencaoRecurso: { findMany: async () => [] },
  programacaoRecurso: {
    findFirst: async () => ({ data: ANTERIOR }),
    findMany: async () => [{ tag: 'ON-01', ...tardeNaOrigem }],
    count: async () => 0,
    deleteMany: async (args) => { gravados.push({ op: 'frota.deleteMany', args }); return { count: 0 }; },
    createMany: async (args) => { gravados.push({ op: 'frota.createMany', args }); return { count: args.data.length }; },
    upsert: async (args) => { gravados.push({ op: 'frota.upsert', args }); return {}; },
  },
  programacaoRecursoTerceiro: {
    findFirst: async () => null,
    findMany: async () => [{ veiculo_terceiro_id: TERCEIRO_ID, ...tardeNaOrigem }],
    count: async () => 0,
    deleteMany: async (args) => { gravados.push({ op: 'terceiro.deleteMany', args }); return { count: 0 }; },
    createMany: async (args) => { gravados.push({ op: 'terceiro.createMany', args }); return { count: args.data.length }; },
    upsert: async (args) => { gravados.push({ op: 'terceiro.upsert', args }); return {}; },
  },
};
banco.$transaction = async (fn) => fn(banco);
globalThis.prisma = banco;

const { default: app } = await import('../src/app.js');
const { assinarSessao } = await import('../src/middleware/sessao.js');

let base;
let servidor;
before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});
after(() => new Promise((r) => servidor.close(r)));

async function api(caminho, { method = 'GET', body, usuario = GESTOR } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (usuario) headers.Authorization = `Bearer ${assinarSessao(usuario)}`;
  const r = await fetch(`${base}${caminho}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

// ---------------------------------------------------------------- 2 motoristas

test('lote grava motorista da manhã e da tarde (frota própria e terceiro)', async () => {
  const r = await api('/programacao-recursos/lote', { method: 'PUT', body: { data: DATA, alteracoes: [
    { tag: 'ON-01', obraId: OBRA, operadorMatricula: '100', operadorTardeMatricula: '101', supervisorMatricula: '200' },
    { tag: 'VAN-T1', obraId: OBRA, operadorMatricula: '100', operadorTardeMatricula: '101' },
  ] } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));

  const frota = gravados.find((g) => g.op === 'frota.upsert').args.create;
  assert.equal(frota.operador_matricula, '100');
  assert.equal(frota.operador_nome, 'Ana Manhã');
  assert.equal(frota.operador_tarde_matricula, '101');
  assert.equal(frota.operador_tarde_nome, 'Bruno Tarde');
  assert.equal(frota.supervisor_nome, 'Carla Supervisora');

  const terceiro = gravados.find((g) => g.op === 'terceiro.upsert').args.create;
  assert.equal(terceiro.operador_tarde_matricula, '101');
  assert.equal(terceiro.operador_tarde_nome, 'Bruno Tarde');
});

test('veículo comum: sem motorista da tarde, nada muda (retrocompatível)', async () => {
  const r = await api('/programacao-recursos/lote', { method: 'PUT', body: { data: DATA, alteracoes: [
    { tag: 'ON-01', obraId: OBRA, operadorMatricula: '100' },
  ] } });
  assert.equal(r.status, 200);
  const { create, update } = gravados.find((g) => g.op === 'frota.upsert').args;
  assert.equal('operador_tarde_matricula' in create, false);
  assert.equal('operador_tarde_matricula' in update, false);
});

test('remover só o motorista da tarde limpa matrícula e nome', async () => {
  await api('/programacao-recursos/lote', { method: 'PUT', body: { data: DATA, alteracoes: [
    { tag: 'ON-01', obraId: OBRA, operadorTardeMatricula: null },
  ] } });
  const { update } = gravados.find((g) => g.op === 'frota.upsert').args;
  assert.equal(update.operador_tarde_matricula, null);
  assert.equal(update.operador_tarde_nome, null);
  assert.equal('operador_matricula' in update, false);
});

test('mesmo colaborador nos dois turnos e matrícula inexistente são recusados', async () => {
  const repetido = await api('/programacao-recursos/lote', { method: 'PUT', body: { data: DATA, alteracoes: [
    { tag: 'ON-01', obraId: OBRA, operadorMatricula: '100', operadorTardeMatricula: '100' },
  ] } });
  assert.equal(repetido.status, 400);
  assert.match(repetido.corpo.message, /tarde deve ser diferente/);

  const inexistente = await api('/programacao-recursos/lote', { method: 'PUT', body: { data: DATA, alteracoes: [
    { tag: 'ON-01', obraId: OBRA, operadorTardeMatricula: '999' },
  ] } });
  assert.equal(inexistente.status, 400);
  assert.equal(gravados.length, 0);
});

test('listagem devolve o motorista da tarde da frota e do terceiro', async () => {
  const { status, corpo } = await api(`/programacao-recursos?data=${DATA}`);
  assert.equal(status, 200);
  for (const tag of ['ON-01', 'VAN-T1']) {
    const e = corpo.data.equipamentos.find((x) => x.tag === tag);
    assert.equal(e.operadorMatricula, '100');
    assert.equal(e.operadorTardeMatricula, '101');
    assert.equal(e.operadorTardeNome, 'Bruno Tarde');
  }
});

test('copiar última programação leva o motorista da tarde junto', async () => {
  const r = await api('/programacao-recursos/copiar-ultima-programacao', { method: 'POST', body: { data: DATA } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const [frota] = gravados.find((g) => g.op === 'frota.createMany').args.data;
  const [terceiro] = gravados.find((g) => g.op === 'terceiro.createMany').args.data;
  for (const linha of [frota, terceiro]) {
    assert.equal(linha.operador_tarde_matricula, '101');
    assert.equal(linha.operador_tarde_nome, 'Bruno Tarde');
    assert.equal('obra' in linha, false);
  }
});

// ---------------------------------------------------------- cadastro rápido

test('cadastro rápido de operador com matrícula informada', async () => {
  const r = await api('/usuarios/rapido', { method: 'POST', body: { nome: '  Diego   Souza ', matricula: '4321', funcao: 'Operador' } });
  assert.equal(r.status, 201);
  assert.deepEqual(
    { matricula: r.corpo.data.matricula, nome: r.corpo.data.nome, funcao: r.corpo.data.funcao, tipo: r.corpo.data.tipo, prov: r.corpo.data.matriculaProvisoria },
    { matricula: '4321', nome: 'Diego Souza', funcao: 'Operador', tipo: 'OPERACIONAL', prov: false },
  );
  assert.equal(r.corpo.data.senha_hash, undefined);
});

test('cadastro rápido de supervisor sem matrícula gera matrícula provisória única', async () => {
  const a = await api('/usuarios/rapido', { method: 'POST', body: { nome: 'Eva Lima', funcao: 'SUPERVISOR' } });
  const b = await api('/usuarios/rapido', { method: 'POST', body: { nome: 'Fábio Reis', funcao: 'SUPERVISOR' } });
  assert.equal(a.status, 201);
  assert.match(a.corpo.data.matricula, /^PROV-[0-9A-F]{8}$/);
  assert.notEqual(a.corpo.data.matricula, b.corpo.data.matricula);
  assert.equal(a.corpo.data.funcao, 'Supervisor');
  assert.equal(a.corpo.data.matriculaProvisoria, true);
});

test('cadastro rápido valida dados, matrícula repetida e permissão', async () => {
  assert.equal((await api('/usuarios/rapido', { method: 'POST', body: { matricula: '1', funcao: 'OPERADOR' } })).status, 400);
  assert.equal((await api('/usuarios/rapido', { method: 'POST', body: { nome: 'X', funcao: 'F'.repeat(101) } })).status, 400);
  assert.equal((await api('/usuarios/rapido', { method: 'POST', body: { nome: 'X', matricula: '1 2', funcao: 'OPERADOR' } })).status, 400);

  const repetida = await api('/usuarios/rapido', { method: 'POST', body: { nome: 'Outra Ana', matricula: '100', funcao: 'OPERADOR' } });
  assert.equal(repetida.status, 409);
  assert.match(repetida.corpo.message, /Ana Manhã/);

  assert.equal((await api('/usuarios/rapido', { method: 'POST', body: { nome: 'X', funcao: 'OPERADOR' }, usuario: null })).status, 401);
  assert.equal((await api('/usuarios/rapido', { method: 'POST', body: { nome: 'X', funcao: 'OPERADOR' }, usuario: AMBIENTAL })).status, 403);
});

test('usuário criado no cadastro rápido já pode ser escalado como motorista da tarde', async () => {
  const novo = await api('/usuarios/rapido', { method: 'POST', body: { nome: 'Gil Motorista', funcao: 'OPERADOR' } });
  const r = await api('/programacao-recursos/lote', { method: 'PUT', body: { data: DATA, alteracoes: [
    { tag: 'ON-01', obraId: OBRA, operadorMatricula: '100', operadorTardeMatricula: novo.corpo.data.matricula },
  ] } });
  assert.equal(r.status, 200);
  assert.equal(gravados.find((g) => g.op === 'frota.upsert').args.create.operador_tarde_nome, 'Gil Motorista');
});

test('cadastro rápido = Usuário Operacional: função livre e nada administrativo', async () => {
  const r = await api('/usuarios/rapido', { method: 'POST', body: {
    matricula: '7788', nome: 'Hugo Munck', funcao: '  Operador   de Munck ',
    // Tentativas de escalar privilégio são ignoradas:
    tipo: 'ADMINISTRADOR', setor: 'GESTAO', nivel: 'MASTER', senha: '123456', senha_hash: 'x',
  } });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.data.funcao, 'Operador de Munck');
  assert.equal(r.corpo.data.tipo, 'OPERACIONAL');
  assert.deepEqual(criadosNoBanco.at(-1), { nome: 'Hugo Munck', matricula: '7788', funcao: 'Operador de Munck', tipo: 'OPERACIONAL', contrato: '251' });
});

test('cadastro rápido sem função grava função vazia (como no cadastro operacional)', async () => {
  const r = await api('/usuarios/rapido', { method: 'POST', body: { matricula: '7789', nome: 'Ivo Ajudante' } });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.data.funcao, null);
});

test('cadastro rápido herda o contrato de quem cadastra; só Master escolhe outro contrato', async () => {
  const herdado = await api('/usuarios/rapido', { method: 'POST', body: { matricula: '8001', nome: 'Herdeiro Um' } });
  assert.equal(herdado.status, 201);
  assert.equal(criadosNoBanco.at(-1).contrato, '251');
  // Master sem informar usa o próprio (010); informando, usa o escolhido.
  const proprio = await api('/usuarios/rapido', { method: 'POST', usuario: MASTER_010, body: { matricula: '8002', nome: 'Herdeiro Dois' } });
  assert.equal(proprio.status, 201);
  assert.equal(criadosNoBanco.at(-1).contrato, '010');
  const escolhido = await api('/usuarios/rapido', { method: 'POST', usuario: MASTER_010, body: { matricula: '8003', nome: 'Herdeiro Tres', contrato: '251' } });
  assert.equal(escolhido.status, 201);
  assert.equal(criadosNoBanco.at(-1).contrato, '251');
  // Master com o filtro em outro contrato: o cadastro cai nele; em "Todos" precisa escolher.
  const pelaFiltro = await api('/usuarios/rapido?contrato=251', { method: 'POST', usuario: MASTER_010, body: { matricula: '8006', nome: 'Pelo Filtro' } });
  assert.equal(pelaFiltro.status, 201);
  assert.equal(criadosNoBanco.at(-1).contrato, '251');
  assert.equal((await api('/usuarios/rapido?contrato=todos', { method: 'POST', usuario: MASTER_010, body: { matricula: '8007', nome: 'Sem Contrato' } })).status, 400);
  // Não-Master não cadastra em outro contrato; formato inválido é recusado.
  assert.equal((await api('/usuarios/rapido', { method: 'POST', body: { matricula: '8004', nome: 'Fora', contrato: '010' } })).status, 403);
  for (const ruim of ['25', '2511', '25a', '2 5', 'CT-251', 251]) {
    assert.equal((await api('/usuarios/rapido', { method: 'POST', usuario: MASTER_010, body: { matricula: '8005', nome: 'Ruim', contrato: ruim } })).status, 400, String(ruim));
  }
});
