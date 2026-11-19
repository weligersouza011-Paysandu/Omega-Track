// Cache dos arquivos estaticos: assets com hash por 1 ano; index/SW sempre revalidados.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');
const temBuild = fs.existsSync(path.join(dist, 'index.html'));
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
const cabecalhos = (caminho) => new Promise((resolver, rejeitar) => {
  http.get({ port: porta, path: caminho }, (res) => { res.resume(); res.on('end', () => resolver({ status: res.statusCode, ...res.headers })); }).on('error', rejeitar);
});

test('assets com hash ficam 1 ano; index.html e service worker sempre revalidam', { skip: !temBuild && 'frontend/dist nao existe (rode npm run build)' }, async () => {
  const asset = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.endsWith('.js'));
  assert.match((await cabecalhos(`/assets/${asset}`))['cache-control'], /max-age=31536000.*immutable/);
  assert.equal((await cabecalhos('/index.html'))['cache-control'], 'no-cache');
  assert.equal((await cabecalhos('/sw.js'))['cache-control'], 'no-cache');
});
