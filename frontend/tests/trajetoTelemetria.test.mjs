import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agruparTrajetos, atalhoAtivo, dataBrasilia, filtrarVeiculos, normalizarPlaca, paramsTrajeto, periodoDoAtalho,
  podeExcluirPorPlaca, rotuloPlacaSemCadastro, statusDoCadastro, temCoordenadas, textoAlertaPlacas,
  textoConfirmacaoExclusao, textoVelocidade, validarFiltroTrajeto,
} from '../src/utils/trajetoTelemetria.js';

test('placa normalizada como no back-end', () => {
  assert.equal(normalizarPlaca('qvn-4g02 CT-251'), 'QVN4G02');
  assert.equal(normalizarPlaca(' abc 1234 '), 'ABC1234');
});

test('atalhos de período em -03:00, inclusive na virada UTC', () => {
  // 16/11 01:30 UTC = 15/11 22:30 em Brasília.
  const agora = new Date('2026-11-16T01:30:00Z');
  assert.equal(dataBrasilia(0, agora), '2026-11-15');
  assert.deepEqual(periodoDoAtalho('hoje', agora), { dataInicio: '2026-11-15', dataFim: '2026-11-15' });
  assert.deepEqual(periodoDoAtalho('ontem', agora), { dataInicio: '2026-11-14', dataFim: '2026-11-14' });
  assert.deepEqual(periodoDoAtalho('7dias', agora), { dataInicio: '2026-11-09', dataFim: '2026-11-15' });
  assert.equal(atalhoAtivo({ dataInicio: '2026-11-09', dataFim: '2026-11-15' }, agora), '7dias');
  assert.equal(atalhoAtivo({ dataInicio: '2026-11-01', dataFim: '2026-11-15' }, agora), null);
});

test('validação do filtro de trajeto', () => {
  const ok = { dataInicio: '2026-11-02', dataFim: '2026-11-03', horaInicio: '22:00', horaFim: '23:59' };
  assert.equal(validarFiltroTrajeto(ok), null);
  assert.equal(validarFiltroTrajeto({ ...ok, dataFim: ok.dataInicio }), null, 'um único dia');
  assert.match(validarFiltroTrajeto({ ...ok, dataFim: '2026-11-01' }), /data final/);
  assert.match(validarFiltroTrajeto({ ...ok, horaFim: '21:00' }), /hora final/);
  assert.match(validarFiltroTrajeto({ ...ok, dataInicio: '2026-01-01', dataFim: '2026-03-01' }), /31 dias/);
  assert.match(validarFiltroTrajeto({ ...ok, dataInicio: '' }), /data inicial/);
});

test('query string do trajeto', () => {
  const q = new URLSearchParams(paramsTrajeto({ veiculo: ' CA-0412 ', dataInicio: '2026-11-02', dataFim: '2026-11-03', horaInicio: '', horaFim: '18:00' }));
  assert.equal(q.get('veiculo'), 'CA-0412');
  assert.equal(q.get('horaInicio'), '00:00');
  assert.equal(q.get('horaFim'), '18:00');
  assert.equal(new URLSearchParams(paramsTrajeto({ dataInicio: 'a', dataFim: 'b' })).has('veiculo'), false);
});

test('busca de veículo por TAG ou placa e selo de mobilização', () => {
  const frota = [
    { tag: 'VAN-021', placa: 'SZI0F03', status: 'Desmobilizado' },
    { tag: 'CA-0412', placa: 'QVN4G02', status: 'Mobilizado' },
  ];
  assert.deepEqual(filtrarVeiculos(frota, 'qvn-4g').map((v) => v.tag), ['CA-0412']);
  assert.deepEqual(filtrarVeiculos(frota, 'van021').map((v) => v.tag), ['VAN-021']);
  assert.deepEqual(filtrarVeiculos(frota, '').map((v) => v.tag), ['CA-0412', 'VAN-021']);
  assert.equal(statusDoCadastro(frota[0]), 'DESMOBILIZADO');
  assert.equal(statusDoCadastro(frota[1]), 'MOBILIZADO');
  assert.equal(statusDoCadastro(null), 'NAO_CADASTRADO');
});

test('trajeto: uma linha cronológica por veículo, só com pontos georreferenciados', () => {
  const pontos = [
    { id: '3', tag: 'CA-0412', tag_placa: 'QVN4G02 CT-251', data_hora: '2026-11-03T03:00:00Z', latitude: -6.1, longitude: -50.1 },
    { id: '1', tag: 'CA-0412', tag_placa: 'QVN4G02 CT-251', data_hora: '2026-11-03T01:00:00Z', latitude: -6.0, longitude: -50.0 },
    { id: '2', tag: null, tag_placa: 'abc-1d23', data_hora: '2026-11-03T02:00:00Z', latitude: -6.2, longitude: -50.2 },
    { id: '4', tag: null, tag_placa: 'ABC1D23', data_hora: '2026-11-03T01:30:00Z', latitude: -6.3, longitude: -50.3 },
    { id: '5', tag: 'CA-0412', tag_placa: 'QVN4G02', data_hora: '2026-11-03T02:00:00Z', latitude: null, longitude: null },
    { id: '6', tag: 'CA-0412', tag_placa: 'QVN4G02', data_hora: '2026-11-03T02:10:00Z', latitude: 0, longitude: 0 },
  ];
  const grupos = agruparTrajetos(pontos);
  assert.deepEqual(grupos.map((g) => [g.chave, g.pontos.map((p) => p.id)]), [
    ['CA-0412', ['1', '3']],
    ['ABC1D23', ['4', '2']],
  ]);
  assert.equal(temCoordenadas(pontos[4]), false);
});

test('velocidade / limite', () => {
  assert.equal(textoVelocidade({ valor: 61.4, limite: 50 }), '61 km/h / 50 km/h');
  assert.equal(textoVelocidade({ valor: 40, limite: null }), '40 km/h');
  assert.equal(textoVelocidade({}), '—');
});

test('alerta e exclusão de placas sem cadastro', () => {
  assert.equal(podeExcluirPorPlaca({ tipo: 'ADMINISTRADOR', setor: 'TRANSPORTE' }), true);
  assert.equal(podeExcluirPorPlaca({ tipo: 'ADMINISTRADOR', setor: 'GESTAO' }), true);
  assert.equal(podeExcluirPorPlaca({ tipo: 'ADMINISTRADOR', setor: 'MANUTENCAO', nivel: 'MASTER' }), true);
  assert.equal(podeExcluirPorPlaca({ tipo: 'ADMINISTRADOR', setor: 'MANUTENCAO' }), false);
  assert.equal(podeExcluirPorPlaca({ tipo: 'OPERACIONAL', setor: 'TRANSPORTE' }), false);
  const p = { placa: 'ABC1D23', totalEventos: 14 };
  assert.equal(rotuloPlacaSemCadastro(p), 'ABC1D23 • 14 registros');
  assert.equal(textoConfirmacaoExclusao(p), 'Excluir todos os 14 registros de telemetria da placa ABC1D23?');
  assert.equal(rotuloPlacaSemCadastro({ placa: 'X', totalEventos: 1 }), 'X • 1 registro');
  assert.match(textoAlertaPlacas(2), /^2 placas .* não estão mobilizadas nem desmobilizadas/);
  assert.match(textoAlertaPlacas(1), /^1 placa .* não está mobilizada/);
});
