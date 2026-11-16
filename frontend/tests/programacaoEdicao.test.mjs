import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alteracaoParaSalvar, ehOnibusOuVan, mesclarAlteracao, mudancaInverterTurnos,
} from '../src/utils/programacaoEdicao.js';

const OBRA = 'obra-1';
const onibus = { tag: 'ON-01', modelo: 'Ônibus', obraId: OBRA, operadorMatricula: '100', operadorTardeMatricula: '101', supervisorMatricula: null };

test('identifica ônibus, micro-ônibus e vans; demais veículos não', () => {
  for (const c of ['Ônibus', 'ONIBUS', 'Micro-ônibus', 'MICRO-ONIBUS', 'Microônibus', 'Van', 'VAN Sprinter', 'Vans']) {
    assert.equal(ehOnibusOuVan(c), true, c);
  }
  for (const c of ['Caminhonete', 'Caminhão Munck', 'Guindaste', 'Caravana', 'Vanguarda', '', null]) {
    assert.equal(ehOnibusOuVan(c), false, String(c));
  }
});

test('inverter turnos troca manhã e tarde e marca a linha como alterada', () => {
  const editado = mesclarAlteracao(onibus, undefined, mudancaInverterTurnos(onibus, undefined));
  assert.equal(editado.operadorMatricula, '101');
  assert.equal(editado.operadorTardeMatricula, '100');
  assert.deepEqual(alteracaoParaSalvar('ON-01', onibus, editado),
    { tag: 'ON-01', obraId: OBRA, operadorMatricula: '101', operadorTardeMatricula: '100' });
});

test('inverter duas vezes volta ao original (linha deixa de ficar pendente)', () => {
  const uma = mesclarAlteracao(onibus, undefined, mudancaInverterTurnos(onibus, undefined));
  assert.equal(mesclarAlteracao(onibus, uma, mudancaInverterTurnos(onibus, uma)), null);
});

test('escolher para a manhã quem está à tarde troca os dois (sem pessoa repetida)', () => {
  const editado = mesclarAlteracao(onibus, undefined, { operadorMatricula: '101' });
  assert.equal(editado.operadorMatricula, '101');
  assert.equal(editado.operadorTardeMatricula, '100');
  const inverso = mesclarAlteracao(onibus, undefined, { operadorTardeMatricula: '100' });
  assert.deepEqual([inverso.operadorMatricula, inverso.operadorTardeMatricula], ['101', '100']);
});

test('tirar a obra libera os dois motoristas e o supervisor', () => {
  const editado = mesclarAlteracao({ ...onibus, supervisorMatricula: '200' }, undefined, { obraId: null });
  assert.deepEqual(editado, { obraId: null, operadorMatricula: null, operadorTardeMatricula: null, supervisorMatricula: null });
});

test('veículo comum: só o operador muda e a tarde não é enviada', () => {
  const leve = { tag: 'JI1', modelo: 'Caminhonete', obraId: OBRA, operadorMatricula: '100' };
  const editado = mesclarAlteracao(leve, undefined, { operadorMatricula: '102' });
  assert.deepEqual(alteracaoParaSalvar('JI1', leve, editado), { tag: 'JI1', obraId: OBRA, operadorMatricula: '102' });
});
