// Modo offline: cache Network First, fila de mutações e sincronização.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarArmazenamentoMemoria } from '../src/offline/armazenamento.js';
import { criarMotorOffline } from '../src/offline/motor.js';
import { aplicarPendencias, classificarResposta } from '../src/offline/regras.js';

const ORIGEM = 'http://omega.test';
const OBRA = '11111111-1111-4111-8111-111111111111';
const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
const semRede = () => Promise.reject(new TypeError('Failed to fetch'));

const programacao = (data) => ({
  data: {
    data,
    equipamentos: [{ tag: 'JI439', obraId: null, operadorMatricula: null, operadorNome: null, supervisorMatricula: null, supervisorNome: null }],
    pessoas: [{ matricula: '100', nome: 'João Silva' }],
    obras: [{ id: OBRA, nome: 'Obra Norte', ativo: true }],
  },
});

function cenario() {
  let rede = true;
  const enviados = [];
  let servidor = (url, init) => {
    if (init?.method && init.method !== 'GET') { enviados.push({ url, metodo: init.method, corpo: init.body && JSON.parse(init.body) }); }
    if (String(url).startsWith('/api/programacao-recursos/lote')) return json({ data: { salvas: 1 } });
    if (String(url).startsWith('/api/programacao-recursos')) return json(programacao('2026-11-16'));
    if (String(url) === '/api/veiculos-terceiros' && init?.method === 'POST') return json({ data: { id: 'srv-1' } }, 201);
    if (String(url).startsWith('/api/veiculos-terceiros')) return json({ data: [] });
    return json({});
  };
  const eventos = [];
  let usuario = '90000';
  const motor = criarMotorOffline({
    armazenamento: criarArmazenamentoMemoria(),
    fetchOriginal: async (url, init) => (rede ? servidor(url, init) : semRede()),
    obterUsuario: () => usuario,
    obterHeaders: () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }),
    origem: ORIGEM,
    estaOnline: () => rede,
    emitirEvento: (nome, detalhe) => eventos.push({ nome, detalhe }),
  });
  return {
    motor, enviados, eventos,
    cair: () => { rede = false; },
    voltar: () => { rede = true; },
    trocarUsuario: (m) => { usuario = m; },
    responder: (fn) => { servidor = fn; },
  };
}

const lote = (obraId = OBRA) => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: '2026-11-16', alteracoes: [{ tag: 'JI439', obraId, operadorMatricula: '100' }] }),
});

test('leitura: Network First, cai para o cache sem rede e sinaliza o modo offline', async () => {
  const { motor, cair } = cenario();
  await (await motor.fetch('/api/programacao-recursos?data=2026-11-16')).json();
  cair();
  const resposta = await motor.fetch('/api/programacao-recursos?data=2026-11-16');
  assert.equal(resposta.headers.get('X-Omega-Offline'), 'cache');
  assert.equal((await resposta.json()).data.equipamentos[0].tag, 'JI439');
  assert.equal(motor.obterEstado().servindoCache, true);
  assert.equal(motor.obterEstado().online, false);
  await assert.rejects(motor.fetch('/api/programacao-recursos?data=2026-11-17'), /sem dados salvos/);
});

test('mutação sem rede entra na fila, a tela recebe sucesso e o cache já mostra a alteração', async () => {
  const { motor, cair } = cenario();
  await motor.fetch('/api/programacao-recursos?data=2026-11-16');
  cair();
  const resposta = await motor.fetch('/api/programacao-recursos/lote', lote());
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('X-Omega-Offline'), 'fila');
  assert.deepEqual((await resposta.json()).data, { data: '2026-11-16', salvas: 1 });
  assert.equal(motor.obterEstado().pendentes, 1);

  const { data } = await (await motor.fetch('/api/programacao-recursos?data=2026-11-16')).json();
  assert.equal(data.equipamentos[0].obraId, OBRA);
  assert.equal(data.equipamentos[0].operadorNome, 'João Silva');
  assert.equal(data.equipamentos[0].pendenteSync, true);
});

test('reconexão envia a fila em ordem e avisa as telas', async () => {
  const { motor, cair, voltar, enviados, eventos } = cenario();
  cair();
  await motor.fetch('/api/veiculos-terceiros', { method: 'POST', body: JSON.stringify({ tag: 'ter-9', tipo: 'Van' }) });
  await motor.fetch('/api/programacao-recursos/lote', lote());
  voltar();
  const resultado = await motor.sincronizar();
  assert.equal(resultado.enviados, 2);
  assert.deepEqual(enviados.map((e) => e.metodo), ['POST', 'PUT']);
  assert.equal(enviados[0].corpo.tag, 'ter-9');
  assert.equal(motor.obterEstado().pendentes, 0);
  assert.equal(eventos.length, 1);
});

test('com fila pendente, nova alteração online espera a fila (não inverte a ordem)', async () => {
  const { motor, cair, voltar, enviados } = cenario();
  cair();
  await motor.fetch('/api/programacao-recursos/lote', lote(OBRA));
  voltar();
  await motor.fetch('/api/programacao-recursos/lote', lote(null));
  assert.deepEqual(enviados.map((e) => e.corpo.alteracoes[0].obraId), [OBRA, null]);
});

test('sessão expirada pausa a fila sem perder nada; recusa do servidor é reportada', async () => {
  const { motor, cair, voltar, responder } = cenario();
  cair();
  await motor.fetch('/api/programacao-recursos/lote', lote());
  voltar();
  responder(() => json({ message: 'Sessao expirada' }, 401));
  await motor.sincronizar();
  assert.equal(motor.obterEstado().pendentes, 1);
  assert.equal(motor.obterEstado().precisaLogin, true);

  responder(() => json({ message: 'Obra inativa' }, 400));
  const resultado = await motor.sincronizar();
  assert.equal(motor.obterEstado().pendentes, 0);
  assert.deepEqual(resultado.rejeitados.map((r) => r.mensagem), ['Obra inativa']);
});

test('a fila é por usuário: outro login não envia nem vê as alterações', async () => {
  const { motor, cair, voltar, trocarUsuario, enviados } = cenario();
  cair();
  await motor.fetch('/api/programacao-recursos/lote', lote());
  voltar();
  trocarUsuario('12345');
  await motor.sincronizar();
  assert.equal(enviados.length, 0);
  assert.equal(motor.obterEstado().pendentes, 0);
  trocarUsuario('90000');
  await motor.sincronizar();
  assert.equal(enviados.length, 1);
});

test('excluir terceiro criado offline só desfaz o cadastro local', async () => {
  const { motor, cair, enviados } = cenario();
  await motor.fetch('/api/veiculos-terceiros');
  cair();
  const criado = await (await motor.fetch('/api/veiculos-terceiros', { method: 'POST', body: JSON.stringify({ tag: 'TER-5', tipo: 'Van' }) })).json();
  assert.match(criado.data.id, /^local-/);
  let lista = (await (await motor.fetch('/api/veiculos-terceiros')).json()).data;
  assert.deepEqual(lista.map((v) => v.tag), ['TER-5']);

  const exclusao = await motor.fetch(`/api/veiculos-terceiros/${criado.data.id}`, { method: 'DELETE' });
  assert.equal(exclusao.status, 204);
  assert.equal(motor.obterEstado().pendentes, 0);
  lista = (await (await motor.fetch('/api/veiculos-terceiros')).json()).data;
  assert.equal(lista.length, 0);
  assert.equal(enviados.length, 0);
});

test('ações fora da lista (cópia, uploads) continuam exigindo conexão', async () => {
  const { motor, cair } = cenario();
  cair();
  await assert.rejects(motor.fetch('/api/programacao-recursos/copiar-ultima-programacao', { method: 'POST', body: '{}' }), TypeError);
  assert.equal(motor.obterEstado().pendentes, 0);
});

test('classificação das respostas na sincronização', () => {
  assert.equal(classificarResposta(204), 'ok');
  assert.equal(classificarResposta(401), 'login');
  assert.equal(classificarResposta(503), 'repetir');
  assert.equal(classificarResposta(409), 'rejeitado');
  assert.equal(aplicarPendencias('/api/obras', { data: [] }, [{}]).data.length, 0);
});
