// Compressao gzip das respostas (JSON grande e bundles do frontend).
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

globalThis.prisma = {};
const { default: app } = await import('../src/app.js');

let servidor;
let porta;
before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  porta = servidor.address().port;
});
after(() => new Promise((r) => servidor.close(r)));

function obter(caminho, aceitaGzip) {
  return new Promise((resolver, rejeitar) => {
    http.get({ port: porta, path: caminho, headers: aceitaGzip ? { 'Accept-Encoding': 'gzip' } : {} }, (res) => {
      const partes = [];
      res.on('data', (p) => partes.push(p));
      res.on('end', () => resolver({ status: res.statusCode, cabecalhos: res.headers, bytes: Buffer.concat(partes).length }));
    }).on('error', rejeitar);
  });
}

test('resposta grande vai comprimida quando o cliente aceita gzip', async () => {
  const comGzip = await obter('/api', true);
  const semGzip = await obter('/api', false);
  assert.equal(comGzip.status, 200);
  assert.equal(comGzip.cabecalhos['content-encoding'], 'gzip');
  assert.equal(semGzip.cabecalhos['content-encoding'], undefined);
  assert.ok(comGzip.bytes < semGzip.bytes * 0.6, `esperava ao menos 40% menor: ${comGzip.bytes} vs ${semGzip.bytes}`);
});

test('cabecalhos de seguranca e sem X-Powered-By', async () => {
  const r = await obter('/ping', false);
  assert.equal(r.cabecalhos['x-content-type-options'], 'nosniff');
  assert.equal(r.cabecalhos['x-powered-by'], undefined);
});
