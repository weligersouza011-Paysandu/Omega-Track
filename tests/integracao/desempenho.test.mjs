// ============================================================================
// Desempenho/consistencia contra PostgreSQL de verdade (PGlite):
//   - semanas da telemetria agrupadas NO BANCO = mesmo resultado do calculo em JS
//     (inclui viradas de ano ISO e a borda do fuso -03:00) e respeitam o contrato;
//   - cache curto do usuario da sessao nao atrasa mudanca de contrato/nivel.
// ============================================================================
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { iniciarAmbiente } from './ambiente.mjs';
import { semearTudo } from './dados.mjs';
import { semanaISO } from '../../src/utils/semanasTelemetria.js';

let ambiente;
let semente;
let ids;
let base;
let servidor;
let assinarSessao;
let prismaComTrava;

before(async () => {
  ambiente = await iniciarAmbiente();
  semente = ambiente.semente;
  ids = await semearTudo(semente);
  ({ assinarSessao } = await import('../../src/middleware/sessao.js'));
  ({ default: prismaComTrava } = await import('../../src/config/database.js'));
  servidor = ambiente.app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
}, { timeout: 120000 });

after(async () => {
  await new Promise((r) => servidor?.close(r));
  await ambiente?.encerrar();
});

async function chamar(usuarioId, caminho) {
  const usuario = await semente.usuario.findUnique({ where: { id: usuarioId } });
  const resp = await fetch(`${base}${caminho}`, { headers: { Authorization: `Bearer ${assinarSessao(usuario)}` } });
  return { status: resp.status, corpo: await resp.json().catch(() => null) };
}

test('semanas em SQL = calculo em JS (virada de ano ISO, borda do fuso, tipos de evento) e isolam contrato', async () => {
  const evento = (n, iso, tipo, contrato) => ({
    tag_placa: `PL${contrato}${n}`, tag: `${contrato}V1`, data_hora: new Date(iso), evento: tipo, severidade: 'MODERADO',
    chave_unica: `sem-${contrato}-${n}`, contrato,
  });
  const lote = [
    ['2025-12-29T02:00:00Z', 'Excesso de Velocidade'],   // dom 28/12 23:00 (-03) -> 2025-52
    ['2025-12-29T03:30:00Z', 'Fadiga / Sono'],           // seg 29/12 00:30 -> 2026-01 (ano ISO vira)
    ['2026-01-01T12:00:00Z', 'Arrancada Brusca'],        // quinta -> 2026-01
    ['2026-01-05T02:59:00Z', 'Excesso de Velocidade'],   // dom 04/01 23:59 -> 2026-01
    ['2026-01-05T03:00:00Z', 'Fadiga sem Parada Obrigatória'], // seg 05/01 00:00 -> 2026-02 (so no total)
    ['2026-01-05T03:01:00Z', 'Freada de Emergência'],    // 2026-02
    ['2026-06-10T15:00:00Z', 'Excesso de Velocidade'],
  ];
  await semente.eventoTelemetria.createMany({
    data: [
      ...lote.map(([iso, tipo], i) => evento(i, iso, tipo, '251')),
      ...lote.map(([iso, tipo], i) => evento(i, iso, tipo, '999')), // outro contrato: nao pode contar
    ],
  });

  // Esperado: o mesmo agrupamento que o codigo antigo fazia em JS.
  const esperado = new Map();
  for (const e of await semente.eventoTelemetria.findMany({ where: { contrato: '251' } })) {
    const { ano, semana, chave } = semanaISO(e.data_hora);
    const s = esperado.get(chave) || { chave, ano, semana, total: 0, velocidade: 0, fadiga: 0, outros: 0 };
    s.total += 1;
    if (e.evento === 'Excesso de Velocidade') s.velocidade += 1;
    else if (e.evento === 'Fadiga / Sono') s.fadiga += 1;
    else if (e.evento !== 'Fadiga sem Parada Obrigatória') s.outros += 1;
    esperado.set(chave, s);
  }

  const r = await chamar(ids['251'].gestao, '/telemetria/semanas');
  assert.equal(r.status, 200);
  const recebido = r.corpo.semanas.map(({ chave, ano, semana, total, velocidade, fadiga, outros }) => ({ chave, ano, semana, total, velocidade, fadiga, outros }));
  assert.deepEqual(
    recebido.sort((a, b) => a.chave.localeCompare(b.chave)),
    [...esperado.values()].sort((a, b) => a.chave.localeCompare(b.chave)),
  );
  assert.ok(recebido.some((s) => s.chave === '2025-52') && recebido.some((s) => s.chave === '2026-01') && recebido.some((s) => s.chave === '2026-02'));
  assert.equal(recebido.reduce((soma, s) => soma + s.total, 0), lote.length + 1 /* o evento do seed */);
  // Mais recente primeiro; padrao = as duas mais recentes.
  assert.deepEqual(r.corpo.semanas.map((s) => s.chave), [...r.corpo.semanas.map((s) => s.chave)].sort().reverse());
  assert.equal(r.corpo.padrao.length, 2);

  // Master em "Todos" soma os dois contratos.
  const todos = await chamar(ids.master, '/telemetria/semanas?contrato=todos');
  assert.equal(todos.corpo.semanas.reduce((soma, s) => soma + s.total, 0), (lote.length + 1) * 2);
});

test('cache da sessao: mudar contrato/nivel do usuario vale na proxima requisicao', async () => {
  const alvo = ids['251'].normal;
  assert.ok((await chamar(alvo, '/obras')).corpo.data.every((o) => o.contrato === '251'));
  // Escrita pelo cliente com trava (como o app faz): invalida o cache do usuario na hora.
  await prismaComTrava.usuario.update({ where: { id: alvo }, data: { contrato: '999' } });
  const depois = await chamar(alvo, '/obras');
  assert.ok(depois.corpo.data.length > 0 && depois.corpo.data.every((o) => o.contrato === '999'), 'o contrato novo deveria valer imediatamente');
  // Excluir o usuario derruba o acesso na hora (nada de sessao "fantasma" ate o cache expirar).
  const token = assinarSessao(await semente.usuario.findUnique({ where: { id: alvo } }));
  assert.equal((await fetch(`${base}/obras`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  await prismaComTrava.usuario.delete({ where: { id: alvo } });
  assert.equal((await fetch(`${base}/obras`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});
