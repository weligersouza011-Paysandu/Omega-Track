import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alternarSelecaoMestre, aptaParaLoteTransporte, estadoSelecaoMestre, pendenciaKmFinalizacao, podeAprovarLoteTransporte,
} from '../src/utils/aprovacaoLote.js';

const fin = (extra = {}) => ({ id: 'a', status_aprovacao: 'Finalizado pelo Operador', km_inicial: '10', km_final: '20', ...extra });

test('KM para finalizar como operador', () => {
  assert.equal(pendenciaKmFinalizacao('10', '20'), null);
  assert.match(pendenciaKmFinalizacao('', '20'), /KM Inicial/);
  assert.match(pendenciaKmFinalizacao('10', '0'), /KM Final/);
  assert.equal(pendenciaKmFinalizacao('', '20', 'Manutenção Preventiva'), null);
});

test('permissão e aptidão para o lote', () => {
  assert.equal(podeAprovarLoteTransporte({ tipo: 'ADMINISTRADOR', setor: 'TRANSPORTE' }), true);
  assert.equal(podeAprovarLoteTransporte({ tipo: 'ADMINISTRADOR', nivel: 'MASTER', setor: 'GESTAO' }), true);
  assert.equal(podeAprovarLoteTransporte({ tipo: 'ADMINISTRADOR', setor: 'GESTAO' }), false);
  assert.equal(podeAprovarLoteTransporte({ tipo: 'OPERACIONAL', setor: 'TRANSPORTE' }), false);
  assert.equal(aptaParaLoteTransporte(fin()), true);
  assert.equal(aptaParaLoteTransporte(fin({ km_final: '' })), false);
  assert.equal(aptaParaLoteTransporte(fin({ status_aprovacao: 'Em Preenchimento' })), false);
  assert.equal(aptaParaLoteTransporte(fin({ assinaturas: [{ etapa: 'OPERADOR' }, { etapa: 'transporte' }] })), false);
});

test('checkbox mestre: nenhum → todos → nenhum; parcial = alguns', () => {
  const aptas = [{ id: 'a' }, { id: 'b' }];
  assert.equal(estadoSelecaoMestre(aptas, new Set()), 'nenhum');
  assert.equal(estadoSelecaoMestre(aptas, new Set(['a'])), 'alguns');
  const todos = alternarSelecaoMestre(aptas, new Set(['a']));
  assert.deepEqual([...todos].sort(), ['a', 'b']);
  assert.equal(estadoSelecaoMestre(aptas, todos), 'todos');
  assert.equal(alternarSelecaoMestre(aptas, todos).size, 0);
  // Selecionados fora da lista visível são preservados.
  assert.deepEqual([...alternarSelecaoMestre(aptas, new Set(['z']))].sort(), ['a', 'b', 'z']);
  assert.equal(estadoSelecaoMestre([], new Set(['a'])), 'nenhum');
});
