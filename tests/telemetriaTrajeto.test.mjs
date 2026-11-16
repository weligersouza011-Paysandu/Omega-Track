// Trajeto (janela de horário por dia em -03:00), placas sem cadastro e exclusão por placa,
// pela API real (Express + middlewares + controller) com o Prisma em memória.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { criarPrismaEmMemoria } from './helpers/prismaTelemetriaEmMemoria.mjs';

const ADMIN_GESTAO = { id: '00000000-0000-4000-8000-000000000011', nome: 'Gestao', matricula: '91001', setor: 'GESTAO', nivel: 'PADRAO' };
const ADMIN_TRANSPORTE = { id: '00000000-0000-4000-8000-000000000012', nome: 'Transporte', matricula: '91002', setor: 'TRANSPORTE', nivel: 'PADRAO' };
const ADMIN_MANUTENCAO = { id: '00000000-0000-4000-8000-000000000013', nome: 'Manutencao', matricula: '91003', setor: 'MANUTENCAO', nivel: 'PADRAO' };

const banco = criarPrismaEmMemoria({
  veiculos: [
    { tag: 'CA-0412', placa: 'QVN4G02', status: 'Mobilizado', deletado_em: null },
    { tag: 'VAN-021', placa: 'SZI0F03', status: 'Desmobilizado', deletado_em: null },
  ],
  administradores: [ADMIN_GESTAO, ADMIN_TRANSPORTE, ADMIN_MANUTENCAO],
});
globalThis.prisma = banco;

const { default: app } = await import('../src/app.js');
const { assinarSessao } = await import('../src/middleware/sessao.js');
const { lerFiltroTrajeto, filtroDataHoraTrajeto, normalizarPlaca, statusMobilizacao } = await import('../src/services/telemetriaTrajetoService.js');

const AUTH = { 'x-acting-matricula': ADMIN_GESTAO.matricula };
const jwt = (u) => ({ Authorization: `Bearer ${assinarSessao({ tipo: 'ADMINISTRADOR', ...u })}` });
let servidor;
let base;

before(async () => {
  servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  base = `http://127.0.0.1:${servidor.address().port}/api/telemetria`;
});
after(() => new Promise((resolve) => servidor.close(resolve)));

let seq = 0;
function evento(tag_placa, isoUtc, extra = {}) {
  seq += 1;
  return {
    tag_placa, data_hora: new Date(isoUtc), evento: 'Excesso de Velocidade', severidade: 'NORMAL',
    chave_unica: `teste-${seq}`, latitude: -6, longitude: -50, ...extra,
  };
}

async function semear(lista) {
  banco.eventos.splice(0);
  banco.logs.splice(0);
  await banco.eventoTelemetria.createMany({ data: lista });
}

async function chamar(caminho, opcoes = {}) {
  const resposta = await fetch(`${base}${caminho}`, { headers: AUTH, ...opcoes });
  return { status: resposta.status, corpo: await resposta.json() };
}

beforeEach(() => { banco.eventos.splice(0); banco.logs.splice(0); });

// ----------------------------------------------------------------------------
// Regras puras
// ----------------------------------------------------------------------------

test('normaliza placas: maiúsculas, sem hífen e sem espaços', () => {
  assert.equal(normalizarPlaca('abc-1d23'), 'ABC1D23');
  assert.equal(normalizarPlaca(' qvn 4g02 CT-251 '), 'QVN4G02');
  assert.equal(normalizarPlaca('ABC-1234'), 'ABC1234');
});

test('janelas do trajeto em -03:00: cada dia vira [horaInicio, horaFim + 1 min) em UTC', () => {
  const f = lerFiltroTrajeto({ dataInicio: '2026-11-02', dataFim: '2026-11-03', horaInicio: '22:00', horaFim: '23:59' });
  assert.deepEqual(f.janelas.map((j) => [j.inicio.toISOString(), j.fim.toISOString()]), [
    ['2026-11-03T01:00:00.000Z', '2026-11-03T03:00:00.000Z'],
    ['2026-11-04T01:00:00.000Z', '2026-11-04T03:00:00.000Z'],
  ]);
  const padrao = lerFiltroTrajeto({ dataInicio: '2026-11-03', dataFim: '2026-11-03' });
  assert.equal(padrao.horaInicio, '00:00');
  assert.equal(padrao.horaFim, '23:59');
  assert.deepEqual(filtroDataHoraTrajeto(padrao), {
    data_hora: { gte: new Date('2026-11-03T03:00:00.000Z'), lt: new Date('2026-11-04T03:00:00.000Z') },
  });
});

test('status de mobilização a partir do cadastro', () => {
  assert.equal(statusMobilizacao({ status: 'Mobilizado' }), 'MOBILIZADO');
  assert.equal(statusMobilizacao({ status: 'Desmobilizado' }), 'DESMOBILIZADO');
  assert.equal(statusMobilizacao(null), 'NAO_CADASTRADO');
});

// ----------------------------------------------------------------------------
// GET /trajeto
// ----------------------------------------------------------------------------

test('trajeto com vários dias e janela de horário, respeitando a borda do fuso -03:00', async () => {
  await semear([
    evento('QVN4G02 CT-251', '2026-11-04T02:30:00Z', { tag: 'CA-0412' }), // 03/11 23:30 -> dentro
    evento('QVN4G02 CT-251', '2026-11-03T03:00:00Z', { tag: 'CA-0412' }), // 03/11 00:00 -> fora (antes das 22:00)
    evento('qvn-4g02', '2026-11-03T02:59:30Z'), //                          02/11 23:59:30 -> dentro (borda)
    evento('QVN4G02 CT-251', '2026-11-03T01:00:00Z', { tag: 'CA-0412' }), // 02/11 22:00 -> dentro (borda)
    evento('QVN4G02 CT-251', '2026-11-03T00:59:59Z', { tag: 'CA-0412' }), // 02/11 21:59:59 -> fora
    evento('QVN4G02 CT-251', '2026-11-04T03:00:00Z', { tag: 'CA-0412' }), // 04/11 00:00 -> fora (após dataFim)
    evento('QVN4G02 CT-251', '2026-11-02T02:00:00Z', { tag: 'CA-0412' }), // 01/11 23:00 -> fora (antes de dataInicio)
    evento('ZZZ9Z99', '2026-11-03T01:30:00Z'), //                            outro veículo, dentro da janela
  ]);

  const { status, corpo } = await chamar('/trajeto?veiculo=qvn-4g02&dataInicio=2026-11-02&dataFim=2026-11-03&horaInicio=22:00&horaFim=23:59');
  assert.equal(status, 200);
  assert.deepEqual(corpo.pontos.map((p) => p.data_hora), [
    '2026-11-03T01:00:00.000Z',
    '2026-11-03T02:59:30.000Z',
    '2026-11-04T02:30:00.000Z',
  ]);
  assert.equal(corpo.veiculo.status_mobilizacao, 'MOBILIZADO');
  assert.equal(corpo.veiculo.tag, 'CA-0412');

  // Pela TAG dá o mesmo trajeto.
  const porTag = await chamar('/trajeto?veiculo=CA-0412&dataInicio=2026-11-02&dataFim=2026-11-03&horaInicio=22:00');
  assert.equal(porTag.corpo.total, 3);

  // Sem veículo: todos os veículos na janela, em ordem de data_hora.
  const todos = await chamar('/trajeto?dataInicio=2026-11-02&dataFim=2026-11-03&horaInicio=22:00&horaFim=23:59');
  assert.equal(todos.corpo.veiculo, null);
  assert.deepEqual(todos.corpo.pontos.map((p) => p.data_hora), [
    '2026-11-03T01:00:00.000Z', '2026-11-03T01:30:00.000Z', '2026-11-03T02:59:30.000Z', '2026-11-04T02:30:00.000Z',
  ]);
});

test('trajeto de um único dia na virada UTC: 00:00–00:30 local é 03:00–03:31 UTC', async () => {
  await semear([
    evento('QVN4G02', '2026-11-03T02:59:59Z'), // 02/11 23:59:59 -> fora
    evento('QVN4G02', '2026-11-03T03:00:00Z'), // 03/11 00:00 -> dentro
    evento('QVN4G02', '2026-11-03T03:30:59Z'), // 03/11 00:30:59 -> dentro (minuto de horaFim)
    evento('QVN4G02', '2026-11-03T03:31:00Z'), // 03/11 00:31 -> fora
  ]);
  const { corpo } = await chamar('/trajeto?veiculo=QVN4G02&dataInicio=2026-11-03&dataFim=2026-11-03&horaFim=00:30');
  assert.deepEqual(corpo.pontos.map((p) => p.data_hora), ['2026-11-03T03:00:00.000Z', '2026-11-03T03:30:59.000Z']);
});

test('trajeto informa desmobilizado e não cadastrado', async () => {
  await semear([evento('SZI-0F03', '2026-11-03T12:00:00Z'), evento('ABC1D23', '2026-11-03T12:00:00Z')]);
  const desmob = await chamar('/trajeto?veiculo=szi0f03&dataInicio=2026-11-03&dataFim=2026-11-03');
  assert.equal(desmob.corpo.veiculo.status_mobilizacao, 'DESMOBILIZADO');
  assert.equal(desmob.corpo.total, 1);
  const ausente = await chamar('/trajeto?veiculo=abc-1d23&dataInicio=2026-11-03&dataFim=2026-11-03');
  assert.equal(ausente.corpo.veiculo.status_mobilizacao, 'NAO_CADASTRADO');
  assert.equal(ausente.corpo.total, 1);
  const semEventos = await chamar('/trajeto?veiculo=XYZ9999&dataInicio=2026-11-03&dataFim=2026-11-03');
  assert.equal(semEventos.status, 200);
  assert.equal(semEventos.corpo.total, 0);
});

test('trajeto: parâmetros inválidos respondem 400', async () => {
  for (const q of [
    'dataFim=2026-11-03',
    'dataInicio=2026-11-03',
    'dataInicio=03/11/2026&dataFim=2026-11-03',
    'dataInicio=2026-02-30&dataFim=2026-03-01',
    'dataInicio=2026-11-04&dataFim=2026-11-03',
    'dataInicio=2026-11-03&dataFim=2026-11-03&horaInicio=24:00',
    'dataInicio=2026-11-03&dataFim=2026-11-03&horaFim=7h',
    'dataInicio=2026-11-03&dataFim=2026-11-03&horaInicio=10:00&horaFim=09:00',
    'dataInicio=2026-01-01&dataFim=2026-03-01',
  ]) {
    const { status } = await chamar(`/trajeto?${q}`);
    assert.equal(status, 400, q);
  }
});

// ----------------------------------------------------------------------------
// GET /placas-nao-cadastradas
// ----------------------------------------------------------------------------

test('desmobilizado não gera alerta; placa ausente do cadastro gera (grafias somadas)', async () => {
  await semear([
    evento('QVN4G02 CT-251', '2026-11-03T12:00:00Z', { tag: 'CA-0412' }), // mobilizado
    evento('szi-0f03 CT-9', '2026-11-03T12:00:00Z'), //                     desmobilizado: sem alerta
    evento('ABC-1D23', '2026-11-05T10:00:00Z'),
    evento('abc 1d23', '2026-11-01T08:00:00Z'),
    evento('ABC1D23', '2026-11-03T09:00:00Z'),
  ]);
  const { status, corpo } = await chamar('/placas-nao-cadastradas');
  assert.equal(status, 200);
  assert.deepEqual(corpo.placas, [{
    placa: 'ABC1D23',
    totalEventos: 3,
    primeiroRegistro: '2026-11-01T08:00:00.000Z',
    ultimoRegistro: '2026-11-05T10:00:00.000Z',
  }]);
});

// ----------------------------------------------------------------------------
// DELETE /por-placa/:placa
// ----------------------------------------------------------------------------

test('exclusão em massa de uma placa não cadastrada, com auditoria', async () => {
  await semear([
    evento('ABC-1D23', '2026-11-05T10:00:00Z'),
    evento('abc 1d23 CT-1', '2026-11-01T08:00:00Z'),
    evento('QVN4G02 CT-251', '2026-11-03T12:00:00Z', { tag: 'CA-0412' }),
  ]);
  const { status, corpo } = await chamar('/por-placa/abc1d23', { method: 'DELETE', headers: jwt(ADMIN_TRANSPORTE) });
  assert.equal(status, 200);
  assert.equal(corpo.total_excluido, 2);
  assert.equal(corpo.placa, 'ABC1D23');
  assert.deepEqual(banco.eventos.map((e) => e.tag_placa), ['QVN4G02 CT-251']);
  assert.equal(banco.logs.length, 1);
  assert.equal(banco.logs[0].acao, 'EXCLUIR_EVENTOS_TELEMETRIA_PLACA');
  assert.equal(banco.logs[0].modulo, 'TELEMETRIA');
  assert.equal(banco.logs[0].usuario_id, ADMIN_TRANSPORTE.id);
  assert.equal(banco.logs[0].detalhes.total_excluido, 2);

  const placas = await chamar('/placas-nao-cadastradas');
  assert.equal(placas.corpo.total, 0);

  const deNovo = await chamar('/por-placa/ABC-1D23', { method: 'DELETE', headers: jwt(ADMIN_GESTAO) });
  assert.equal(deNovo.status, 404);
});

test('exclusão por placa: só Master, Gestão e Transporte, com JWT', async () => {
  await semear([evento('ABC-1D23', '2026-11-05T10:00:00Z')]);
  const semPerfil = await chamar('/por-placa/ABC1D23', { method: 'DELETE', headers: jwt(ADMIN_MANUTENCAO) });
  assert.equal(semPerfil.status, 403);
  const semJwt = await chamar('/por-placa/ABC1D23', { method: 'DELETE' }); // só x-acting-matricula
  assert.equal(semJwt.status, 401);
  assert.equal(banco.eventos.length, 1);
  const master = await chamar('/por-placa/ABC1D23', {
    method: 'DELETE', headers: jwt({ ...ADMIN_MANUTENCAO, nivel: 'MASTER' }),
  });
  assert.equal(master.status, 403, 'o nível vem do banco, não do token');
});
