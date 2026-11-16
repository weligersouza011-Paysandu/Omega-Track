// Aderência à Programação na Parte Diária (RDO): regra pura + API real com um
// Prisma em memória "permissivo" (Proxy) que só responde de verdade ao que
// importa aqui (veículo, obras, programação, categorias e o RDO gravado).
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  avaliarAderencia, resolverJustificativa, statusAderencia,
} from '../src/services/aderenciaProgramacaoService.js';

const ADMIN = { id: '00000000-0000-4000-8000-000000000001', nome: 'Gestor', matricula: '90000', tipo: 'ADMINISTRADOR', nivel: 'MASTER', setor: 'GESTAO' };
const OBRA_A = '11111111-1111-4111-8111-111111111111';
const OBRA_B = '22222222-2222-4222-8222-222222222222';
const CAT_ATIVA = '33333333-3333-4333-8333-333333333333';
const CAT_INATIVA = '44444444-4444-4444-8444-444444444444';
const DIA = '2026-11-16';
const JUST = 'Cliente pediu apoio urgente na obra B.';

const obras = {
  [OBRA_A]: { id: OBRA_A, nome: 'Obra Norte', numero_contrato: 'CT-1', contratante: 'Vale', gestao: 'G1', planejador: 'Pedro', ativo: true },
  [OBRA_B]: { id: OBRA_B, nome: 'Usina Sul', numero_contrato: 'CT-2', contratante: 'Vale', gestao: 'G2', planejador: 'Rita', ativo: true },
};
let categorias;
let partes;
const programacao = { tag: 'JI439', data: DIA, obra_id: OBRA_A, operador_matricula: '100', operador_nome: 'Ana',
  operador_tarde_matricula: null, operador_tarde_nome: null, supervisor_matricula: '200', supervisor_nome: 'Carla' };

beforeEach(() => {
  categorias = {
    [CAT_ATIVA]: { id: CAT_ATIVA, nome: 'Solicitação Urgente do Cliente', ativo: true, partes: 0 },
    [CAT_INATIVA]: { id: CAT_INATIVA, nome: 'Erro de Programação', ativo: false, partes: 0 },
  };
  partes = new Map();
});

// ------------------------------------------------------------------ regra pura

const prog = { obra: obras[OBRA_A] };

test('avaliação: mesma obra = aderente; outra obra ou sem obra = desvio; sem programação = null', () => {
  assert.equal(avaliarAderencia(prog, { obraId: OBRA_A }).aderencia, true);
  assert.equal(avaliarAderencia(prog, { obraId: OBRA_B }).aderencia, false);
  assert.equal(avaliarAderencia(prog, { obraId: null, obraTexto: null }).aderencia, false);
  assert.equal(avaliarAderencia(prog, { obraTexto: '  obra   NORTE ' }).aderencia, true); // RDO antigo em texto
  assert.deepEqual(avaliarAderencia(null, { obraId: OBRA_A }), { obra_programada_id: null, obra_programada: null, aderencia: null });
  assert.equal(avaliarAderencia(prog, { obraId: OBRA_B }).obra_programada_id, OBRA_A);
});

test('status de aderência e pendência de justificativa', () => {
  assert.deepEqual(statusAderencia({ aderencia: true }), { status: 'ADERENTE', justificativa_pendente: false });
  assert.deepEqual(statusAderencia({ aderencia: false }), { status: 'DESVIO', justificativa_pendente: true });
  assert.deepEqual(statusAderencia({ aderencia: false, categoria_desvio_id: 'x', justificativa_desvio: JUST }),
    { status: 'DESVIO', justificativa_pendente: false });
  assert.equal(statusAderencia({ aderencia: null }).status, 'SEM_PROGRAMACAO');
});

test('justificativa: limpa sem desvio, valida categoria/tamanho no desvio, aceita categoria já gravada', async () => {
  const client = { categoriaDesvioProgramacao: { findUnique: async ({ where }) => categorias[where.id] || null } };
  assert.deepEqual(await resolverJustificativa(client, true, { categoriaId: CAT_ATIVA, justificativa: JUST }),
    { categoria_desvio_id: null, justificativa_desvio: null });
  assert.deepEqual(await resolverJustificativa(client, false, { categoriaId: CAT_ATIVA, justificativa: `  ${JUST}  ` }),
    { categoria_desvio_id: CAT_ATIVA, justificativa_desvio: JUST });
  await assert.rejects(resolverJustificativa(client, false, { categoriaId: CAT_INATIVA }), /inválida ou inativa/);
  await assert.rejects(resolverJustificativa(client, false, { justificativa: 'curta' }), /entre 10 e 2000/);
  assert.equal((await resolverJustificativa(client, false, { categoriaId: CAT_INATIVA, categoriaAtual: CAT_INATIVA }))
    .categoria_desvio_id, CAT_INATIVA);
  assert.deepEqual(await resolverJustificativa(client, false, {}), { categoria_desvio_id: null, justificativa_desvio: null });
});

// ------------------------------------------------------------- API (sem banco)

const dia = (d) => new Date(`${d}T00:00:00.000Z`).getTime();
const modelos = {
  usuario: { findUnique: async ({ where }) => (where.id === ADMIN.id || where.matricula === ADMIN.matricula ? ADMIN : null), findFirst: async () => ADMIN },
  mobDesmob: { findFirst: async ({ where }) => (String(where?.tag?.equals ?? where?.tag).toUpperCase() === 'JI439'
    ? { tag: 'JI439', placa: 'ABC1D23', modelo: 'Caminhonete', status: 'Mobilizado', data_mob: new Date('2026-01-01'), data_desmob: null, deletado_em: null }
    : null) },
  obra: { findUnique: async ({ where }) => obras[where.id] || null },
  programacaoRecurso: {
    findUnique: async ({ where }) => (where.tag_data.tag === programacao.tag && where.tag_data.data.getTime() === dia(programacao.data)
      ? { ...programacao, obra: obras[programacao.obra_id] } : null),
  },
  categoriaDesvioProgramacao: {
    findUnique: async ({ where }) => {
      const c = categorias[where.id];
      return c ? { ...c, _count: { partes_diarias: c.partes } } : null;
    },
    findFirst: async ({ where }) => Object.values(categorias).find((c) => c.nome.toLowerCase() === where.nome.equals.toLowerCase()
      && c.id !== where.NOT?.id) || null,
    findMany: async () => Object.values(categorias).map((c) => ({ ...c, _count: { partes_diarias: c.partes } })),
    create: async ({ data }) => { const c = { id: '55555555-5555-4555-8555-555555555555', ativo: true, partes: 0, ...data }; categorias[c.id] = c; return c; },
    update: async ({ where, data }) => Object.assign(categorias[where.id], data),
    delete: async ({ where }) => { delete categorias[where.id]; },
  },
  parteDiaria: {
    // Limite diário de RDO = 0 existentes; no resumo, conta desvios sem justificativa.
    count: async ({ where }) => (where?.aderencia === false
      ? [...partes.values()].filter((p) => p.aderencia === false && (!p.categoria_desvio_id || !p.justificativa_desvio)).length
      : 0),
    groupBy: async ({ by: [campo], where }) => {
      const grupos = new Map();
      for (const p of partes.values()) {
        if (where.aderencia !== undefined && p.aderencia !== where.aderencia) continue;
        const chave = p[campo] ?? null;
        grupos.set(chave, (grupos.get(chave) || 0) + 1);
      }
      return [...grupos].map(([valor, total]) => ({ [campo]: valor, _count: { _all: total } }));
    },
    create: async ({ data }) => { const p = { id: `p${partes.size + 1}`, deletado_em: null, ...data }; partes.set(p.id, p); return p; },
    update: async ({ where, data }) => Object.assign(partes.get(where.id), data),
    findFirst: async ({ where }) => partes.get(where.id) || null,
    findUnique: async ({ where }) => (partes.has(where.id) ? { ...partes.get(where.id), assinaturas: [] } : null),
  },
};
const neutro = (metodo) => async () => (metodo.startsWith('findMany') || metodo === 'groupBy' ? []
  : metodo === 'count' ? 0 : metodo.startsWith('find') ? null : {});
const modelo = (nome) => new Proxy(modelos[nome] || {}, { get: (alvo, metodo) => alvo[metodo] || neutro(String(metodo)) });
const banco = new Proxy({}, {
  get: (_alvo, prop) => {
    if (prop === '$transaction') return async (fn) => (typeof fn === 'function' ? fn(banco) : Promise.all(fn));
    if (prop === '$queryRaw' || prop === '$executeRaw') return async () => [];
    if (prop === 'then') return undefined;
    return modelo(prop);
  },
});
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

async function api(caminho, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${assinarSessao(ADMIN)}`;
  const r = await fetch(`${base}${caminho}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, corpo: r.status === 204 ? null : await r.json().catch(() => null) };
}

const rdo = (extra = {}) => ({ tag: 'JI439', data: DIA, status_operacional: 'Operação', obra: 'Obra Norte', obra_id: OBRA_A, ...extra });

test('obra programada para autopreencher o RDO', async () => {
  const { status, corpo } = await api(`/partes-diarias/obra-programada?tag=JI439&data=${DIA}`);
  assert.equal(status, 200);
  assert.equal(corpo.data.programada, true);
  assert.deepEqual(
    { id: corpo.data.obra.id, contrato: corpo.data.obra.numero_contrato, planejador: corpo.data.obra.planejador },
    { id: OBRA_A, contrato: 'CT-1', planejador: 'Pedro' },
  );
  assert.deepEqual(corpo.data.operador, { matricula: '100', nome: 'Ana' });
  assert.equal(corpo.data.operador_tarde, null);

  const livre = await api('/partes-diarias/obra-programada?tag=JI439&data=2026-11-17');
  assert.deepEqual([livre.corpo.data.programada, livre.corpo.data.obra], [false, null]);
  assert.equal((await api('/partes-diarias/obra-programada?tag=JI439&data=16/11/2026')).status, 400);
});

test('RDO na obra programada fica aderente (servidor ignora obra_programada do cliente)', async () => {
  const r = await api('/partes-diarias', { method: 'POST', body: rdo({ obra_programada: 'Qualquer coisa' }) });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const gravado = partes.get(r.corpo.data.id);
  assert.equal(gravado.aderencia, true);
  assert.equal(gravado.obra_programada_id, OBRA_A);
  assert.equal(gravado.obra_programada, 'Obra Norte');
  assert.deepEqual(r.corpo.data.aderencia_programacao, { status: 'ADERENTE', justificativa_pendente: false });
});

test('RDO em outra obra = desvio; salva sem justificativa (pendente) e grava quando informada', async () => {
  const sem = await api('/partes-diarias', { method: 'POST', body: rdo({ obra: 'Usina Sul', obra_id: OBRA_B }) });
  assert.equal(sem.status, 201);
  assert.equal(partes.get(sem.corpo.data.id).aderencia, false);
  assert.deepEqual(sem.corpo.data.aderencia_programacao, { status: 'DESVIO', justificativa_pendente: true });

  const com = await api(`/partes-diarias/${sem.corpo.data.id}`, { method: 'PUT',
    body: { categoria_desvio_id: CAT_ATIVA, justificativa_desvio: JUST } });
  assert.equal(com.status, 200, JSON.stringify(com.corpo));
  const gravado = partes.get(sem.corpo.data.id);
  assert.deepEqual([gravado.categoria_desvio_id, gravado.justificativa_desvio], [CAT_ATIVA, JUST]);
  assert.deepEqual(com.corpo.data.aderencia_programacao, { status: 'DESVIO', justificativa_pendente: false });
});

test('corrigir a obra para a programada limpa a justificativa', async () => {
  const criado = await api('/partes-diarias', { method: 'POST',
    body: rdo({ obra: 'Usina Sul', obra_id: OBRA_B, categoria_desvio_id: CAT_ATIVA, justificativa_desvio: JUST }) });
  await api(`/partes-diarias/${criado.corpo.data.id}`, { method: 'PUT', body: { obra: 'Obra Norte', obra_id: OBRA_A } });
  const gravado = partes.get(criado.corpo.data.id);
  assert.deepEqual([gravado.aderencia, gravado.categoria_desvio_id, gravado.justificativa_desvio], [true, null, null]);
});

test('programado e em manutenção (sem obra) também é desvio', async () => {
  const r = await api('/partes-diarias', { method: 'POST',
    body: rdo({ status_operacional: 'Manutenção Corretiva', obra: null, obra_id: null }) });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(partes.get(r.corpo.data.id).aderencia, false);
});

test('veículo sem programação no dia não entra no indicador', async () => {
  const r = await api('/partes-diarias', { method: 'POST', body: rdo({ data: '2026-11-17' }) });
  const gravado = partes.get(r.corpo.data.id);
  assert.deepEqual([gravado.aderencia, gravado.obra_programada_id], [null, null]);
  assert.equal(r.corpo.data.aderencia_programacao.status, 'SEM_PROGRAMACAO');
});

test('justificativa inválida ou categoria inativa barram o salvamento', async () => {
  const curta = await api('/partes-diarias', { method: 'POST', body: rdo({ obra_id: OBRA_B, justificativa_desvio: 'curta' }) });
  assert.equal(curta.status, 400);
  const inativa = await api('/partes-diarias', { method: 'POST', body: rdo({ obra_id: OBRA_B, categoria_desvio_id: CAT_INATIVA }) });
  assert.equal(inativa.status, 400);
  assert.equal(partes.size, 0);
});

test('categorias: listar ativas, criar, renomear, e excluir em uso apenas desativa', async () => {
  const ativas = await api('/categorias-desvio?ativas=1', { auth: false });
  assert.equal(ativas.status, 200);

  assert.equal((await api('/categorias-desvio', { method: 'POST', body: { nome: 'Chuva' }, auth: false })).status, 401);
  const nova = await api('/categorias-desvio', { method: 'POST', body: { nome: '  Chuva   Forte ' } });
  assert.equal(nova.status, 201);
  assert.equal(nova.corpo.data.nome, 'Chuva Forte');
  assert.equal((await api('/categorias-desvio', { method: 'POST', body: { nome: 'chuva forte' } })).status, 409);

  categorias[CAT_ATIVA].partes = 3;
  const emUso = await api(`/categorias-desvio/${CAT_ATIVA}`, { method: 'DELETE' });
  assert.equal(emUso.status, 200);
  assert.equal(emUso.corpo.data.desativada, true);
  assert.equal(categorias[CAT_ATIVA].ativo, false);

  assert.equal((await api(`/categorias-desvio/${nova.corpo.data.id}`, { method: 'DELETE' })).status, 204);
  assert.equal(categorias[nova.corpo.data.id], undefined);
});

test('resumo do indicador: % só sobre programados, pendências e desvios por categoria', async () => {
  await api('/partes-diarias', { method: 'POST', body: rdo() });                                   // aderente
  await api('/partes-diarias', { method: 'POST', body: rdo({ obra_id: OBRA_B, obra: 'Usina Sul',
    categoria_desvio_id: CAT_ATIVA, justificativa_desvio: JUST }) });                              // desvio justificado
  await api('/partes-diarias', { method: 'POST', body: rdo({ obra_id: OBRA_B, obra: 'Usina Sul' }) }); // desvio pendente
  await api('/partes-diarias', { method: 'POST', body: rdo({ data: '2026-11-17' }) });             // sem programação

  const { status, corpo } = await api(`/partes-diarias/aderencia?inicio=${DIA}&fim=2026-11-17`);
  assert.equal(status, 200);
  assert.deepEqual(
    { programados: corpo.data.programados, aderentes: corpo.data.aderentes, desvios: corpo.data.desvios,
      sem: corpo.data.sem_programacao, pct: corpo.data.percentual_aderencia, pend: corpo.data.justificativas_pendentes },
    { programados: 3, aderentes: 1, desvios: 2, sem: 1, pct: 33.3, pend: 1 },
  );
  assert.deepEqual(corpo.data.desvios_por_categoria.map((c) => [c.categoria, c.total]).sort(),
    [['Sem categoria', 1], ['Solicitação Urgente do Cliente', 1]]);
  assert.equal((await api('/partes-diarias/aderencia?inicio=2026-11-17&fim=2026-11-16')).status, 400);
  assert.equal((await api(`/partes-diarias/aderencia?inicio=${DIA}&fim=${DIA}`, { auth: false })).status, 401);
});
