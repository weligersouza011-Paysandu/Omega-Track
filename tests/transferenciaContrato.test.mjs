// Troca de contrato com data efetiva: da data em diante tudo do veiculo vai ao
// contrato novo; o que veio antes permanece no contrato antigo (historico).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const FUSO = 3 * 3600 * 1000;
const iso = (d) => d.toISOString().slice(0, 10);
const diasAtras = (n) => new Date(Date.now() - FUSO - n * 86400000);
const dia = (n) => new Date(`${iso(diasAtras(n))}T00:00:00.000Z`);
const U = (id, nivel, contrato = '251') => ({
  id: `00000000-0000-4000-8000-0000000000${id}`, nome: `U${id}`, matricula: `30${id}`, contrato,
  tipo: 'ADMINISTRADOR', nivel, setor: 'TRANSPORTE',
});
const MASTER = U('01', 'MASTER');
const NORMAL = U('02', 'NORMAL');
const ALVO = { ...U('03', 'NORMAL'), tipo: 'OPERACIONAL' };
const USUARIOS = [MASTER, NORMAL, ALVO];

const veiculo = { tag: 'A1', placa: 'AAA1A11', contrato: '251', status: 'Mobilizado', deletado_em: null, data_mob: dia(60), created_at: dia(60) };
let historico;
let partes;
let abastecimentos;
let eventos;
let programacao;

const gte = (campo, limite) => (r) => new Date(r[campo]).getTime() >= new Date(limite).getTime();
const prisma = {
  usuario: {
    findUnique: async ({ where }) => USUARIOS.find((u) => u.id === where.id) || null,
    update: async ({ where, data }) => Object.assign(USUARIOS.find((u) => u.id === where.id), data),
    findFirst: async () => null,
  },
  logAtividade: { create: async () => ({}) },
  mobDesmob: {
    findFirst: async () => ({ ...veiculo }),
    update: async ({ data }) => Object.assign(veiculo, data),
  },
  veiculoContratoHistorico: {
    findFirst: async ({ where }) => historico.find((h) => h.tag === where.tag && h.vigente_ate === null) || null,
    findMany: async ({ where }) => historico.filter((h) => h.tag === where.tag).sort((a, b) => b.vigente_desde - a.vigente_desde),
    create: async ({ data }) => { const l = { id: `h${historico.length}`, vigente_ate: null, ...data }; historico.push(l); return l; },
    update: async ({ where, data }) => Object.assign(historico.find((h) => h.id === where.id), data),
  },
  programacaoRecurso: {
    count: async ({ where }) => programacao.filter((p) => p.tag === where.tag && gte('data', where.data.gte)(p)).length,
    deleteMany: async ({ where }) => { programacao = programacao.filter((p) => !(p.tag === where.tag && gte('data', where.data.gte)(p))); },
  },
  parteDiaria: {
    count: async () => 0,
    updateMany: async ({ where, data }) => {
      const alvo = partes.filter((p) => p.tag === where.tag && gte('data', where.data.gte)(p));
      alvo.forEach((p) => Object.assign(p, data));
      return { count: alvo.length };
    },
  },
  abastecimento: {
    updateMany: async ({ where, data }) => {
      const alvo = abastecimentos.filter((p) => p.tag === where.tag && gte('data_transacao', where.data_transacao.gte)(p));
      alvo.forEach((p) => Object.assign(p, data));
      return { count: alvo.length };
    },
  },
  eventoTelemetria: {
    updateMany: async ({ where, data }) => {
      const alvo = eventos.filter((p) => p.tag === where.tag && gte('data_hora', where.data_hora.gte)(p));
      alvo.forEach((p) => Object.assign(p, data));
      return { count: alvo.length };
    },
  },
  $queryRaw: async () => [],
  $transaction: async (fn) => fn(prisma),
};
globalThis.prisma = prisma;

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

function reiniciar() {
  veiculo.contrato = '251';
  historico = [{ id: 'h0', tag: 'A1', contrato: '251', vigente_desde: dia(60), vigente_ate: null }];
  partes = [
    { id: 'p1', tag: 'A1', data: dia(8), contrato: '251' },
    { id: 'p2', tag: 'A1', data: dia(5), contrato: '251' },
    { id: 'p3', tag: 'A1', data: dia(1), contrato: '251' },
    { id: 'p4', tag: 'OUTRO', data: dia(1), contrato: '251' },
  ];
  abastecimentos = [
    { id: 'a1', tag: 'A1', data_transacao: new Date(dia(6).getTime() + FUSO - 3600000), contrato: '251' }, // 23h do dia anterior ao 5-dias-atras? ver teste
    { id: 'a2', tag: 'A1', data_transacao: new Date(dia(5).getTime() + FUSO + 3600000), contrato: '251' },
  ];
  eventos = [
    { id: 'e1', tag: 'A1', data_hora: new Date(dia(5).getTime() + FUSO - 60000), contrato: '251' },
    { id: 'e2', tag: 'A1', data_hora: new Date(dia(5).getTime() + FUSO + 60000), contrato: '251' },
  ];
  programacao = [];
}

const chamar = async (usuario, caminho, corpo, metodo = 'POST') => {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${assinarSessao(usuario)}` },
    body: metodo === 'GET' ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const transferir = (usuario, extra = {}) => chamar(usuario, '/mob-desmob/A1/transferir-contrato',
  { contrato: '010', data_efetiva: iso(diasAtras(5)), ...extra });

test('da data efetiva em diante tudo vai ao contrato novo; o anterior permanece', async () => {
  reiniciar();
  const r = await transferir(MASTER);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.data.transferidos, { partes_diarias: 2, abastecimentos: 1, eventos_telemetria: 1 });
  assert.equal(r.corpo.data.de, '251');
  assert.equal(r.corpo.data.para, '010');
  assert.equal(veiculo.contrato, '010');
  assert.deepEqual(partes.map((p) => [p.id, p.contrato]), [['p1', '251'], ['p2', '010'], ['p3', '010'], ['p4', '251']]);
  assert.deepEqual(abastecimentos.map((a) => [a.id, a.contrato]), [['a1', '251'], ['a2', '010']]);
  assert.deepEqual(eventos.map((e) => [e.id, e.contrato]), [['e1', '251'], ['e2', '010']]);
  // Historico: vigencia antiga fechada no dia anterior; nova aberta na data efetiva.
  assert.equal(iso(historico[0].vigente_ate), iso(diasAtras(6)));
  assert.deepEqual(historico.slice(1).map((h) => [h.contrato, iso(h.vigente_desde), h.vigente_ate]), [['010', iso(diasAtras(5)), null]]);
  const lista = await chamar(MASTER, '/mob-desmob/A1/historico-contrato', null, 'GET');
  assert.deepEqual(lista.corpo.data.historico.map((h) => h.contrato), ['010', '251']);
});

test('programacao a partir da data exige confirmacao e e removida ao confirmar', async () => {
  reiniciar();
  programacao = [{ tag: 'A1', data: dia(3) }, { tag: 'A1', data: dia(10) }, { tag: 'B2', data: dia(3) }];
  const recusada = await transferir(MASTER);
  assert.equal(recusada.status, 409);
  assert.equal(recusada.corpo.codigo, 'PROGRAMACAO_FUTURA');
  assert.equal(recusada.corpo.programacoes, 1);
  assert.equal(veiculo.contrato, '251', 'nada muda sem confirmar');
  const ok = await transferir(MASTER, { confirmar_limpeza_programacao: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.data.programacao_removida, 1);
  assert.deepEqual(programacao.map((p) => [p.tag, iso(p.data)]), [['A1', iso(diasAtras(10))], ['B2', iso(diasAtras(3))]]);
});

test('validacoes: data, contrato e permissao', async () => {
  reiniciar();
  assert.equal((await transferir(NORMAL)).status, 403);                                    // so Master
  assert.equal((await transferir(MASTER, { contrato: '251' })).status, 400);               // mesmo contrato
  assert.equal((await transferir(MASTER, { contrato: '01' })).status, 400);                // formato
  assert.equal((await transferir(MASTER, { data_efetiva: iso(new Date(Date.now() + 3 * 86400000)) })).status, 400); // futuro
  assert.equal((await transferir(MASTER, { data_efetiva: 'ontem' })).status, 400);
  assert.equal((await transferir(MASTER, { data_efetiva: iso(diasAtras(60)) })).status, 400); // nao depois do inicio da vigencia
  assert.equal(veiculo.contrato, '251');
});

test('PUT nao troca mais o contrato do veiculo e do usuario (so a transferencia, com data)', async () => {
  reiniciar();
  const veic = await chamar(MASTER, '/mob-desmob/A1', { contrato: '010' }, 'PUT');
  assert.equal(veic.status, 400);
  assert.match(veic.corpo.message, /Transferir contrato/);
  const usr = await chamar(MASTER, `/usuarios/${ALVO.id}`, { contrato: '010' }, 'PUT');
  assert.equal(usr.status, 400);
  assert.equal(ALVO.contrato, '251');
});

test('transferir usuario: Master troca o contrato; os demais nao', async () => {
  reiniciar();
  assert.equal((await chamar(NORMAL, `/usuarios/${ALVO.id}/transferir-contrato`, { contrato: '010', data_efetiva: iso(diasAtras(1)) })).status, 403);
  const ok = await chamar(MASTER, `/usuarios/${ALVO.id}/transferir-contrato`, { contrato: '010', data_efetiva: iso(diasAtras(1)) });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.corpo.transferencia, { de: '251', para: '010', data_efetiva: iso(diasAtras(1)) });
  assert.equal(ALVO.contrato, '010');
  assert.equal(ok.corpo.data.senha_hash, undefined);
  assert.equal((await chamar(MASTER, `/usuarios/${ALVO.id}/transferir-contrato`, { contrato: '010', data_efetiva: iso(diasAtras(1)) })).status, 400);
});
