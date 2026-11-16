import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';

const admin = { id: randomUUID(), tipo: 'ADMINISTRADOR', matricula: '90000', nome: 'Gestor', setor: 'GESTAO', nivel: 'MASTER' };
const operador = { id: randomUUID(), tipo: 'OPERACIONAL', matricula: '00123', nome: 'Operador QA' };
const usuarios = new Map([[admin.id, admin], [operador.id, operador]]);
const registros = Array.from({ length: 50 }, (_, indice) => ({
  id: randomUUID(), tag: `QA-${indice}`, operador: indice ? '99999' : operador.matricula,
  funcionario: indice ? 'Outra Pessoa' : operador.nome, deletado_em: null,
  veiculo: { deletado_em: null, modelo: 'Caminhonete' },
  obra: 'Obra QA', atividades: [{ descricao: 'Transporte de equipe' }],
  fotos: [{ url: 'https://example.com/foto.jpg' }],
  assinaturas: [{ etapa: 'OPERADOR', assinatura_dado: 'https://example.com/assinatura.png' }],
}));
let consultas = [];
globalThis.prisma = {
  usuario: { findUnique: async ({ where }) => usuarios.get(where.id) || null },
  parteDiaria: { findMany: async (consulta) => {
    consultas.push(consulta);
    const { where } = consulta;
    return registros.filter((parte) => where.id.in.includes(parte.id) && !parte.deletado_em && !parte.veiculo.deletado_em
      && (!where.OR || where.OR.some((condicao) => condicao.operador
        ? parte.operador === condicao.operador
        : parte.funcionario.toLowerCase().includes(condicao.funcionario.contains.toLowerCase())))).reverse();
  } },
};
const { default: app } = await import('../src/app.js');
const { assinarSessao } = await import('../src/middleware/sessao.js');
let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/partes-diarias/exportacao/lote`;
});
after(() => new Promise((resolve) => server.close(resolve)));
const api = async (ids, usuario = admin, headersExtras = {}) => {
  const resposta = await fetch(base, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(usuario ? { Authorization: `Bearer ${assinarSessao(usuario)}` } : {}), ...headersExtras,
  }, body: JSON.stringify({ ids }) });
  return { status: resposta.status, headers: resposta.headers, corpo: await resposta.json() };
};

test('exportação em lote exige JWT válido, sem aceitar matrícula administrativa como autenticação', async () => {
  assert.equal((await api([registros[0].id], null)).status, 401);
  assert.equal((await api([registros[0].id], null, { 'x-acting-matricula': admin.matricula })).status, 401);
  assert.equal((await api([registros[0].id], null, { Authorization: 'Bearer invalido' })).status, 401);
});

test('lote valida UUIDs, duplicados, vazio e limite de 50', async () => {
  for (const ids of [[], ['invalido'], [registros[0].id, registros[0].id], Array.from({ length: 51 }, randomUUID)]) {
    assert.equal((await api(ids)).status, 400);
  }
  assert.equal((await api([registros[0].id, registros[0].id.toUpperCase()])).status, 400);
  const maiusculo = await api([registros[0].id.toUpperCase()]);
  assert.equal(maiusculo.status, 200);
  assert.equal(maiusculo.corpo.data[0].id, registros[0].id);
});

test('administrador recebe os 50 relatórios completos com uma consulta e ordem preservada', async () => {
  consultas = [];
  const ids = registros.map((parte) => parte.id);
  const resultado = await api(ids);
  assert.equal(resultado.status, 200);
  assert.equal(resultado.headers.get('cache-control'), 'no-store');
  assert.deepEqual(resultado.corpo.data.map((parte) => parte.id), ids);
  assert.equal(resultado.corpo.data[0].atividades[0].descricao, 'Transporte de equipe');
  assert.ok(resultado.corpo.data[0].assinaturas[0].assinatura_dado);
  assert.equal(consultas.length, 1);
  assert.equal(consultas[0].select.logs, undefined);
  assert.equal(consultas[0].select.visualizacoes, undefined);
  assert.ok(consultas[0].select.fotos && consultas[0].select.assinaturas);
});

test('operacional só pode obter relatórios próprios e não recebe lote parcial de terceiros', async () => {
  assert.equal((await api([registros[0].id], operador)).status, 200);
  const resposta = await api([registros[0].id, registros[1].id], operador);
  assert.equal(resposta.status, 409);
  assert.equal(resposta.corpo.data, undefined);
});

test('relatório ausente, excluído ou veículo excluído impede o lote incompleto', async () => {
  assert.equal((await api([registros[0].id, randomUUID()])).status, 409);
  registros[0].deletado_em = new Date();
  assert.equal((await api([registros[0].id])).status, 409);
  registros[0].deletado_em = null;
  registros[0].veiculo.deletado_em = new Date();
  assert.equal((await api([registros[0].id])).status, 409);
  registros[0].veiculo.deletado_em = null;
});

test('usuário removido não continua exportando com um JWT antigo', async () => {
  usuarios.delete(operador.id);
  assert.equal((await api([registros[0].id], operador)).status, 401);
  usuarios.set(operador.id, operador);
});
