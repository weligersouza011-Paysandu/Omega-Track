// Endurecimento: limite de tentativas de login e cabecalhos de seguranca.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarLimitadorDeLogin, cabecalhosDeSeguranca } from '../src/middleware/seguranca.js';

function requisicao(ip, matricula) {
  return { ip, body: { matricula }, socket: {} };
}
function resposta() {
  const cabecalhos = {};
  const ouvintes = {};
  return {
    cabecalhos, statusCode: 200, corpo: null,
    setHeader(k, v) { cabecalhos[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(c) { this.corpo = c; return this; },
    on(evento, fn) { ouvintes[evento] = fn; },
    terminar(codigo) { this.statusCode = codigo; ouvintes.finish?.(); },
  };
}
function tentar(limitador, ip, matricula, codigo) {
  const req = requisicao(ip, matricula);
  const res = resposta();
  let passou = false;
  limitador(req, res, () => { passou = true; });
  if (passou) res.terminar(codigo);
  return { passou, res };
}

test('limita falhas por matricula mesmo trocando de IP, e por IP mesmo trocando de matricula', () => {
  let agora = 1_000_000;
  const lim = criarLimitadorDeLogin({ agora: () => agora, limiteIp: 5, limiteMatricula: 3, janelaMs: 60_000 });
  for (let i = 0; i < 3; i += 1) assert.equal(tentar(lim, `10.0.0.${i}`, '1001', 401).passou, true);
  const bloqueada = tentar(lim, '10.0.0.99', '1001', 401);
  assert.equal(bloqueada.passou, false);
  assert.equal(bloqueada.res.statusCode, 429);
  assert.ok(Number(bloqueada.res.cabecalhos['Retry-After']) > 0);
  // Outra matricula, outro IP: liberado.
  assert.equal(tentar(lim, '10.9.9.9', '2002', 200).passou, true);
  // Chutando matriculas inexistentes (404) de um IP so: bloqueia no limite do IP.
  for (let i = 0; i < 5; i += 1) assert.equal(tentar(lim, '10.5.5.5', `chute${i}`, 404).passou, true);
  assert.equal(tentar(lim, '10.5.5.5', 'chute-final', 404).res.statusCode, 429);
  // A janela esvazia: volta a liberar.
  agora += 61_000;
  assert.equal(tentar(lim, '10.5.5.5', 'chute-final', 200).passou, true);
});

test('acertos nao zeram o contador (nao serve para lavar os chutes)', () => {
  const lim = criarLimitadorDeLogin({ limiteIp: 3, limiteMatricula: 99 });
  tentar(lim, '1.1.1.1', 'a', 401);
  tentar(lim, '1.1.1.1', 'b', 404);
  tentar(lim, '1.1.1.1', 'conta-valida', 200);
  tentar(lim, '1.1.1.1', 'c', 401);
  assert.equal(tentar(lim, '1.1.1.1', 'd', 401).res.statusCode, 429);
});

test('cabecalhos de seguranca', () => {
  const res = resposta();
  cabecalhosDeSeguranca({}, res, () => {});
  assert.equal(res.cabecalhos['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.cabecalhos['X-Frame-Options'], 'DENY');
  assert.equal(res.cabecalhos['Referrer-Policy'], 'no-referrer');
});
