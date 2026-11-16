// Fluxo de aprovação da Parte Diária: KM obrigatória para "Finalizado pelo
// Operador" e aprovação em lote pelo Transporte/Master. Regra pura + API real
// com um Prisma em memória "permissivo" (Proxy).
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

const TRANSPORTE = { id: '00000000-0000-4000-8000-000000000001', nome: 'Tiago Transporte', matricula: '7001', tipo: 'ADMINISTRADOR', nivel: 'NORMAL', setor: 'TRANSPORTE', assinatura_padrao: 'https://res.cloudinary.com/x/assin.png' };
const GESTAO = { id: '00000000-0000-4000-8000-000000000002', nome: 'Gil Gestão', matricula: '7002', tipo: 'ADMINISTRADOR', nivel: 'NORMAL', setor: 'GESTAO' };
const MASTER = { id: '00000000-0000-4000-8000-000000000003', nome: 'Mara Master', matricula: '7003', tipo: 'ADMINISTRADOR', nivel: 'MASTER', setor: 'GESTAO', assinatura_padrao: null };
const USUARIOS = [TRANSPORTE, GESTAO, MASTER];

const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const P_OK = id(1); // caminhonete finalizada com KM
const P_ONIBUS = id(2); // ônibus finalizado com KM -> Aprovado
const P_SEM_KM = id(3); // finalizado sem KM final
const P_PREENCHENDO = id(4);
const P_REVISADO = id(5);

let partes;
let assinaturas;
let logs;

function parte(pid, extra = {}) {
  return {
    id: pid, tag: `T${pid.slice(-1)}`, data: new Date('2026-11-16'), status_operacional: 'Operação',
    status_aprovacao: 'Finalizado pelo Operador', status_relatorio: 'REVISAO', status_assinatura: 'PENDENTE',
    km_inicial: '1000', km_final: '1080', deletado_em: null, modelo: 'Caminhonete', ...extra,
  };
}

beforeEach(() => {
  partes = new Map([
    [P_OK, parte(P_OK)],
    [P_ONIBUS, parte(P_ONIBUS, { modelo: 'Ônibus' })],
    [P_SEM_KM, parte(P_SEM_KM, { km_final: null })],
    [P_PREENCHENDO, parte(P_PREENCHENDO, { status_aprovacao: 'Em Preenchimento', status_relatorio: 'PREENCHENDO' })],
    [P_REVISADO, parte(P_REVISADO, { status_aprovacao: 'Revisado pelo Transporte' })],
  ]);
  assinaturas = [P_OK, P_ONIBUS, P_SEM_KM, P_REVISADO].map((pid) => ({ parte_id: pid, etapa: 'OPERADOR', nome: 'Op' }));
  assinaturas.push({ parte_id: P_REVISADO, etapa: 'TRANSPORTE', nome: 'Tr' });
  logs = [];
});

// ------------------------------------------------------------- API (sem banco)

const comAssinaturas = (p) => ({
  ...p, veiculo: { modelo: p.modelo }, assinaturas: assinaturas.filter((a) => a.parte_id === p.id),
});
const casa = (p, where = {}) => {
  if (where.deletado_em === null && p.deletado_em) return false;
  if (where.id?.in && !where.id.in.includes(p.id)) return false;
  if (typeof where.id === 'string' && where.id !== p.id) return false;
  if (where.status_aprovacao && p.status_aprovacao !== where.status_aprovacao) return false;
  return true;
};
const modelos = {
  usuario: {
    findUnique: async ({ where }) => USUARIOS.find((u) => u.id === where.id || u.matricula === where.matricula) || null,
    findFirst: async ({ where }) => USUARIOS.find((u) => u.matricula === where?.matricula) || null,
  },
  mobDesmob: { findFirst: async () => null },
  parteDiaria: {
    findFirst: async ({ where }) => (partes.has(where.id) ? comAssinaturas(partes.get(where.id)) : null),
    findUnique: async ({ where }) => (partes.has(where.id) ? comAssinaturas(partes.get(where.id)) : null),
    findMany: async ({ where }) => [...partes.values()].filter((p) => casa(p, where)).map(comAssinaturas),
    update: async ({ where, data }) => Object.assign(partes.get(where.id), data),
    updateMany: async ({ where, data }) => {
      const alvo = [...partes.values()].filter((p) => casa(p, where));
      alvo.forEach((p) => Object.assign(p, data));
      return { count: alvo.length };
    },
  },
  parteDiariaAssinatura: {
    findMany: async ({ where }) => assinaturas.filter((a) => a.parte_id === where.parte_id),
    upsert: async ({ create }) => { assinaturas.push(create); return create; },
    createMany: async ({ data }) => {
      const novas = data.filter((d) => !assinaturas.some((a) => a.parte_id === d.parte_id && a.etapa === d.etapa));
      assinaturas.push(...novas);
      return { count: novas.length };
    },
    deleteMany: async ({ where }) => {
      const antes = assinaturas.length;
      assinaturas = assinaturas.filter((a) => !(a.parte_id === where.parte_id && a.etapa === where.etapa));
      return { count: antes - assinaturas.length };
    },
  },
  parteDiariaLog: {
    create: async ({ data }) => { logs.push(data); return data; },
    createMany: async ({ data }) => { logs.push(...data); return { count: data.length }; },
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
// Importado depois do stub: o service puxa o manutencaoService (que cria o cliente Prisma).
const {
  classificarLote, normalizarIdsLote, pendenciaKmFinalizacao, podeAprovarLoteTransporte,
} = await import('../src/services/aprovacaoParteDiariaService.js');

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

async function api(caminho, { method = 'GET', body, como = TRANSPORTE } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (como) headers.Authorization = `Bearer ${assinarSessao(como)}`;
  const r = await fetch(`${base}${caminho}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

test('assinatura do OPERADOR é recusada sem KM e aceita com KM', async () => {
  partes.get(P_PREENCHENDO).km_final = '';
  const sem = await api(`/partes-diarias/${P_PREENCHENDO}/assinaturas`, { method: 'POST', body: { etapa: 'OPERADOR', nome: 'Op' } });
  assert.equal(sem.status, 400);
  assert.match(sem.corpo.message, /KM Final/);
  assert.equal(partes.get(P_PREENCHENDO).status_aprovacao, 'Em Preenchimento');

  partes.get(P_PREENCHENDO).km_final = '1090';
  const com = await api(`/partes-diarias/${P_PREENCHENDO}/assinaturas`, { method: 'POST', body: { etapa: 'OPERADOR', nome: 'Op' } });
  assert.equal(com.status, 200, JSON.stringify(com.corpo));
  assert.equal(partes.get(P_PREENCHENDO).status_aprovacao, 'Finalizado pelo Operador');
});

test('apagar a KM de um RDO finalizado volta para Em Preenchimento e retira a assinatura do operador', async () => {
  const r = await api(`/partes-diarias/${P_OK}`, { method: 'PUT', body: { km_final: '', status_aprovacao: 'Finalizado pelo Operador' } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.match(r.corpo.aviso, /KM Final/);
  assert.equal(partes.get(P_OK).status_aprovacao, 'Em Preenchimento');
  assert.equal(assinaturas.some((a) => a.parte_id === P_OK && a.etapa === 'OPERADOR'), false);
  assert.ok(logs.some((l) => l.acao === 'FINALIZACAO_REVERTIDA_KM'));
});

test('lote: sem sessão 401, sem perfil Transporte/Master 403', async () => {
  const body = { ids: [P_OK] };
  assert.equal((await api('/partes-diarias/aprovar-lote-transporte', { method: 'POST', body, como: null })).status, 401);
  assert.equal((await api('/partes-diarias/aprovar-lote-transporte', { method: 'POST', body, como: GESTAO })).status, 403);
  assert.equal(partes.get(P_OK).status_aprovacao, 'Finalizado pelo Operador');
});

test('lote: assina TRANSPORTE nas aptas (ônibus vai a Aprovado) e devolve as recusadas', async () => {
  const r = await api('/partes-diarias/aprovar-lote-transporte', {
    method: 'POST', body: { ids: [P_OK, P_ONIBUS, P_SEM_KM, P_PREENCHENDO] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.data.aprovadas.map((a) => [a.id, a.status_aprovacao]),
    [[P_OK, 'Revisado pelo Transporte'], [P_ONIBUS, 'Aprovado']]);
  assert.deepEqual(r.corpo.data.recusadas.map((x) => x.id), [P_SEM_KM, P_PREENCHENDO]);
  assert.equal(partes.get(P_OK).status_aprovacao, 'Revisado pelo Transporte');
  assert.deepEqual([partes.get(P_ONIBUS).status_aprovacao, partes.get(P_ONIBUS).status_assinatura], ['Aprovado', 'ASSINADO']);
  assert.equal(partes.get(P_SEM_KM).status_aprovacao, 'Finalizado pelo Operador');
  const tr = assinaturas.find((a) => a.parte_id === P_OK && a.etapa === 'TRANSPORTE');
  assert.deepEqual([tr.nome, tr.matricula, tr.assinatura_dado], [TRANSPORTE.nome, TRANSPORTE.matricula, TRANSPORTE.assinatura_padrao]);
  assert.equal(logs.filter((l) => l.acao === 'ASSINATURA_TRANSPORTE_LOTE').length, 2);
});

test('lote: alias /api/rdo, nada apto = 409, Master sem assinatura salva precisa enviar a imagem', async () => {
  const nada = await api('/rdo/aprovar-lote-transporte', { method: 'POST', body: { ids: [P_PREENCHENDO] } });
  assert.equal(nada.status, 409);
  const semImagem = await api('/rdo/aprovar-lote-transporte', { method: 'POST', body: { ids: [P_OK] }, como: MASTER });
  assert.equal(semImagem.status, 400);
  const comImagem = await api('/rdo/aprovar-lote-transporte', {
    method: 'POST', body: { ids: [P_OK], assinatura_dado: 'data:image/png;base64,AAAA' }, como: MASTER,
  });
  assert.equal(comImagem.status, 200, JSON.stringify(comImagem.corpo));
  assert.equal(partes.get(P_OK).status_aprovacao, 'Revisado pelo Transporte');
});

// ------------------------------------------------------------------ regra pura

test('KM para finalizar: inicial e final > 0; preventiva exige só a final', () => {
  assert.equal(pendenciaKmFinalizacao('1000', '1080'), null);
  assert.match(pendenciaKmFinalizacao('', '1080'), /Falta: KM Inicial\./);
  assert.match(pendenciaKmFinalizacao('1000', '0'), /Falta: KM Final\./);
  assert.match(pendenciaKmFinalizacao(null, 'abc'), /KM Inicial e KM Final/);
  assert.equal(pendenciaKmFinalizacao(null, '5000', 'Manutenção Preventiva'), null);
  assert.match(pendenciaKmFinalizacao('1', null, 'Manutenção Preventiva'), /Falta: KM Final/);
});

test('permissão do lote: Transporte ou Master (administradores)', () => {
  assert.equal(podeAprovarLoteTransporte(TRANSPORTE), true);
  assert.equal(podeAprovarLoteTransporte(MASTER), true);
  assert.equal(podeAprovarLoteTransporte(GESTAO), false);
  assert.equal(podeAprovarLoteTransporte({ ...TRANSPORTE, tipo: 'OPERACIONAL' }), false);
});

test('ids do lote: obrigatórios, únicos, UUID e no máximo 200', () => {
  assert.deepEqual(normalizarIdsLote([P_OK, P_OK, ` ${P_ONIBUS} `]), [P_OK, P_ONIBUS]);
  assert.throws(() => normalizarIdsLote([]), /ao menos uma/);
  assert.throws(() => normalizarIdsLote(['x']), /inválidos/);
  assert.throws(() => normalizarIdsLote(Array.from({ length: 201 }, (_, i) => id(i + 10))), /no máximo 200/);
});

test('classificação: só Finalizado pelo Operador, com OPERADOR assinado, KM e sem Transporte', () => {
  const lista = [...partes.values()].map((p) => ({
    ...p, assinaturas: assinaturas.filter((a) => a.parte_id === p.id),
  }));
  const { aptas, recusadas } = classificarLote([P_OK, P_SEM_KM, P_PREENCHENDO, P_REVISADO, id(99)], lista);
  assert.deepEqual(aptas.map((p) => p.id), [P_OK]);
  assert.deepEqual(recusadas.map((r) => r.id), [P_SEM_KM, P_PREENCHENDO, P_REVISADO, id(99)]);
});

// ------------------------------------------------- lote final (Planejamento)

const P_REV_OK = id(21); // revisado, sem desvio (aderente)
const P_REV_SEM_PROG = id(22); // revisado, veículo sem programação (aderencia null)
const P_REV_DESVIO = id(23); // revisado, com desvio -> bloqueado no lote

function prepararRevisadas() {
  for (const [pid, aderencia] of [[P_REV_OK, true], [P_REV_SEM_PROG, null], [P_REV_DESVIO, false]]) {
    partes.set(pid, parte(pid, { status_aprovacao: 'Revisado pelo Transporte', aderencia }));
    assinaturas.push({ parte_id: pid, etapa: 'OPERADOR', nome: 'Op' }, { parte_id: pid, etapa: 'TRANSPORTE', nome: 'Tr' });
  }
}

test('Planejamento: Transporte não aprova a etapa final (403)', async () => {
  prepararRevisadas();
  const r = await api('/partes-diarias/aprovar-lote-planejamento', { method: 'POST', body: { ids: [P_REV_OK] }, como: TRANSPORTE });
  assert.equal(r.status, 403);
  assert.equal(partes.get(P_REV_OK).status_aprovacao, 'Revisado pelo Transporte');
});

test('Planejamento: aprova em lote as revisadas sem desvio e bloqueia as com desvio', async () => {
  prepararRevisadas();
  const r = await api('/partes-diarias/aprovar-lote-planejamento', {
    method: 'POST', body: { ids: [P_REV_OK, P_REV_SEM_PROG, P_REV_DESVIO, P_OK], assinatura_dado: 'data:image/png;base64,AAAA' }, como: GESTAO,
  });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.data.aprovadas.map((a) => [a.id, a.status_aprovacao]),
    [[P_REV_OK, 'Aprovado'], [P_REV_SEM_PROG, 'Aprovado']]);
  const desvio = r.corpo.data.recusadas.find((x) => x.id === P_REV_DESVIO);
  assert.equal(desvio.desvio, true);
  assert.match(desvio.motivo, /desvio de programação/);
  assert.ok(r.corpo.data.recusadas.some((x) => x.id === P_OK)); // ainda não revisada pelo Transporte

  assert.deepEqual([partes.get(P_REV_OK).status_aprovacao, partes.get(P_REV_OK).status_assinatura], ['Aprovado', 'ASSINADO']);
  assert.equal(partes.get(P_REV_DESVIO).status_aprovacao, 'Revisado pelo Transporte');
  assert.equal(assinaturas.some((a) => a.parte_id === P_REV_DESVIO && a.etapa === 'PLANEJADOR'), false);
  const pl = assinaturas.find((a) => a.parte_id === P_REV_OK && a.etapa === 'PLANEJADOR');
  assert.deepEqual([pl.nome, pl.matricula], [GESTAO.nome, GESTAO.matricula]);
  assert.equal(logs.filter((l) => l.acao === 'ASSINATURA_PLANEJADOR_LOTE').length, 2);
});

test('Planejamento: lote só com desvio = 409 sem alterar nada; Master pode pelo alias /api/rdo', async () => {
  prepararRevisadas();
  const so = await api('/partes-diarias/aprovar-lote-planejamento', {
    method: 'POST', body: { ids: [P_REV_DESVIO], assinatura_dado: 'data:image/png;base64,AAAA' }, como: GESTAO,
  });
  assert.equal(so.status, 409);
  assert.equal(so.corpo.recusadas[0].desvio, true);
  assert.equal(partes.get(P_REV_DESVIO).status_aprovacao, 'Revisado pelo Transporte');

  const master = await api('/rdo/aprovar-lote-planejamento', {
    method: 'POST', body: { ids: [P_REV_OK], assinatura_dado: 'data:image/png;base64,AAAA' }, como: MASTER,
  });
  assert.equal(master.status, 200, JSON.stringify(master.corpo));
  assert.equal(partes.get(P_REV_OK).status_aprovacao, 'Aprovado');
});

test('listagem expõe houve_desvio_programacao', async () => {
  prepararRevisadas();
  const r = await api('/partes-diarias?limit=50', { como: GESTAO });
  assert.equal(r.status, 200);
  const porId = new Map(r.corpo.data.map((p) => [p.id, p.houve_desvio_programacao]));
  assert.deepEqual([porId.get(P_REV_OK), porId.get(P_REV_SEM_PROG), porId.get(P_REV_DESVIO)], [false, false, true]);
});

test('classificação do Planejamento: já aprovada/sem Transporte são recusadas', async () => {
  const { classificarLotePlanejamento } = await import('../src/services/aprovacaoParteDiariaService.js');
  const base = { status_aprovacao: 'Revisado pelo Transporte', aderencia: true };
  const { aptas, recusadas } = classificarLotePlanejamento(['a', 'b', 'c'], [
    { id: 'a', ...base, assinaturas: [{ etapa: 'TRANSPORTE' }] },
    { id: 'b', ...base, assinaturas: [] },
    { id: 'c', ...base, assinaturas: [{ etapa: 'TRANSPORTE' }, { etapa: 'PLANEJADOR' }] },
  ]);
  assert.deepEqual(aptas.map((p) => p.id), ['a']);
  assert.deepEqual(recusadas.map((r) => r.id), ['b', 'c']);
});
