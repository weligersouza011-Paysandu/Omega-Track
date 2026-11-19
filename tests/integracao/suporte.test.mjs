// ============================================================================
// Chat de suporte (usuario <-> desenvolvedor) contra PostgreSQL de verdade (PGlite):
// o usuario so ve a propria conversa; todos os Master veem as mesmas conversas e
// qualquer Master responde; nao-Master nao acessa a caixa de entrada.
// ============================================================================
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { iniciarAmbiente } from './ambiente.mjs';
import { semearContrato } from './dados.mjs';

let ambiente;
let p;
let base;
let servidor;
let assinarSessao;
const ids = {};

before(async () => {
  ambiente = await iniciarAmbiente();
  p = ambiente.semente;
  ids['251'] = await semearContrato(p, '251');
  ids['999'] = await semearContrato(p, '999');
  const master = (matricula, nome, contrato) => p.usuario.create({ data: { nome, matricula, contrato, tipo: 'ADMINISTRADOR', setor: 'GESTAO', nivel: 'MASTER' } });
  ids.dev = (await master('23574', 'Weliger Souza', '251')).id;
  ids.master2 = (await master('M2', 'Outro Master', '999')).id;
  ({ assinarSessao } = await import('../../src/middleware/sessao.js'));
  servidor = ambiente.app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
}, { timeout: 120000 });

after(async () => {
  await new Promise((r) => servidor?.close(r));
  await ambiente?.encerrar();
});

async function chamar(usuarioId, metodo, caminho, corpo) {
  const token = assinarSessao(await p.usuario.findUnique({ where: { id: usuarioId } }));
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

test('sem login nao ha acesso ao chat', async () => {
  const r = await fetch(`${base}/suporte/minha`);
  assert.equal(r.status, 401);
});

test('usuario escreve, Master ve em todas as conversas e responde; leitura zera os contadores', async () => {
  const g251 = ids['251'].gestao;
  const operador999 = ids['999'].operador;

  assert.equal((await chamar(g251, 'POST', '/suporte/minha', { texto: '   ' })).status, 400, 'mensagem vazia');
  assert.equal((await chamar(g251, 'POST', '/suporte/minha', { texto: 'x'.repeat(2001) })).status, 400, 'mensagem longa');
  assert.equal((await chamar(g251, 'POST', '/suporte/minha', { texto: 'Nao consigo aprovar o RDO' })).status, 201);
  assert.equal((await chamar(operador999, 'POST', '/suporte/minha', { texto: 'Meu login nao entra' })).status, 201);

  // Cada usuario ve so a propria conversa.
  const minha251 = (await chamar(g251, 'GET', '/suporte/minha')).corpo.data;
  assert.deepEqual(minha251.map((m) => m.texto), ['Nao consigo aprovar o RDO']);
  const minha999 = (await chamar(operador999, 'GET', '/suporte/minha')).corpo.data;
  assert.deepEqual(minha999.map((m) => m.texto), ['Meu login nao entra']);

  // A conversa e a do JWT: enviar "conversa_matricula" no corpo nao muda nada.
  await chamar(g251, 'POST', '/suporte/minha', { texto: 'tentando forjar', conversa_matricula: 'OX999', de_dev: true });
  const forjada = await p.suporteMensagem.findFirst({ where: { texto: 'tentando forjar' } });
  assert.deepEqual([forjada.conversa_matricula, forjada.de_dev], ['GX251', false]);

  // Todos os Master recebem o mesmo aviso.
  for (const master of [ids.dev, ids.master2]) {
    assert.equal((await chamar(master, 'GET', '/suporte/nao-lidas')).corpo.total, 3);
    const lista = (await chamar(master, 'GET', '/suporte/conversas')).corpo.data;
    assert.deepEqual(lista.map((c) => c.matricula).sort(), ['GX251', 'OX999']);
    assert.deepEqual(lista.map((c) => c.nao_lidas).sort(), [1, 2]);
    assert.equal(lista.find((c) => c.matricula === 'GX251').contrato, '251');
  }

  // Master abre a conversa (lidas) e responde; o OUTRO Master tambem ve a resposta.
  const aberta = (await chamar(ids.dev, 'GET', '/suporte/conversas/GX251')).corpo.data;
  assert.equal(aberta[0].texto, 'Nao consigo aprovar o RDO');
  assert.equal((await chamar(ids.master2, 'GET', '/suporte/nao-lidas')).corpo.total, 1, 'so sobrou a conversa do OX999');
  const resposta = await chamar(ids.dev, 'POST', '/suporte/conversas/GX251', { texto: 'Ja estou olhando' });
  assert.equal(resposta.status, 201);
  assert.deepEqual([resposta.corpo.data.de_dev, resposta.corpo.data.autor_nome], [true, 'Weliger Souza']);
  const vistaPeloOutro = (await chamar(ids.master2, 'GET', '/suporte/conversas/GX251')).corpo.data;
  assert.ok(vistaPeloOutro.some((m) => m.texto === 'Ja estou olhando' && m.de_dev));

  // O usuario recebe a resposta como nao lida, e ler zera.
  assert.equal((await chamar(g251, 'GET', '/suporte/nao-lidas')).corpo.total, 1);
  const depois = (await chamar(g251, 'GET', '/suporte/minha')).corpo.data;
  assert.ok(depois.some((m) => m.de_dev && m.texto === 'Ja estou olhando'));
  assert.equal((await chamar(g251, 'GET', '/suporte/nao-lidas')).corpo.total, 0);
  // A resposta ao 251 nao aparece para o 999.
  assert.ok(!JSON.stringify((await chamar(operador999, 'GET', '/suporte/minha')).corpo).includes('Ja estou olhando'));
  assert.equal((await chamar(operador999, 'GET', '/suporte/nao-lidas')).corpo.total, 0);

  // Resposta a conversa que nao existe: 404.
  assert.equal((await chamar(ids.dev, 'POST', '/suporte/conversas/NAOEXISTE', { texto: 'oi' })).status, 404);
});

test('nao-Master nao acessa a caixa de entrada nem responde; Master nao escreve como usuario', async () => {
  for (const perfil of ['normal', 'gestao', 'operador']) {
    const quem = ids['251'][perfil];
    assert.equal((await chamar(quem, 'GET', '/suporte/conversas')).status, 403,`lista (${perfil})`);
    assert.equal((await chamar(quem, 'GET', '/suporte/conversas/OX999')).status, 403, `abrir (${perfil})`);
    assert.equal((await chamar(quem, 'POST', '/suporte/conversas/OX999', { texto: 'sou o dev' })).status, 403, `responder (${perfil})`);
  }
  assert.equal((await chamar(ids.dev, 'POST', '/suporte/minha', { texto: 'oi' })).status, 400);
  assert.equal(await p.suporteMensagem.count({ where: { texto: 'sou o dev' } }), 0);
});

test('limite de mensagens em rajada', async () => {
  const quem = ids['251'].ambiente;
  let ultimo;
  for (let i = 0; i < 22; i += 1) ultimo = await chamar(quem, 'POST', '/suporte/minha', { texto: `spam ${i}` });
  assert.equal(ultimo.status, 429);
  assert.equal(await p.suporteMensagem.count({ where: { conversa_matricula: 'AX251' } }), 20);
});
