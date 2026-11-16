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

import {
  aptaParaLotePlanejamento, comparativoDesvio, contarFiltrosRapidos, houveDesvio, loteDaParte, motivoForaDoLote,
  MSG_DESVIO_LOTE, passaFiltroRapido, podeAprovarLotePlanejamento,
} from '../src/utils/aprovacaoLote.js';

const GESTAO = { tipo: 'ADMINISTRADOR', setor: 'GESTAO' };
const TRANSP = { tipo: 'ADMINISTRADOR', setor: 'TRANSPORTE' };
const MASTER = { tipo: 'ADMINISTRADOR', nivel: 'MASTER', setor: 'GESTAO' };
const rev = (extra = {}) => ({ id: 'r', status_aprovacao: 'Revisado pelo Transporte', houve_desvio_programacao: false,
  assinaturas: [{ etapa: 'OPERADOR' }, { etapa: 'TRANSPORTE' }], ...extra });

test('Planejamento: só revisadas pelo Transporte e sem desvio entram no lote', () => {
  assert.equal(podeAprovarLotePlanejamento(GESTAO), true);
  assert.equal(podeAprovarLotePlanejamento(TRANSP), false);
  assert.equal(aptaParaLotePlanejamento(rev()), true);
  assert.equal(aptaParaLotePlanejamento(rev({ houve_desvio_programacao: true })), false);
  assert.equal(aptaParaLotePlanejamento(rev({ assinaturas: [{ etapa: 'OPERADOR' }] })), false);
  assert.equal(aptaParaLotePlanejamento(rev({ status_aprovacao: 'Aprovado' })), false);
  assert.equal(houveDesvio({ aderencia: false }), true); // fallback sem o campo derivado
});

test('lote por perfil e tooltip da trava de desvio', () => {
  assert.equal(loteDaParte(rev(), GESTAO), 'planejamento');
  assert.equal(loteDaParte(rev(), TRANSP), null);
  assert.equal(loteDaParte(fin(), MASTER), 'transporte');
  assert.equal(loteDaParte(rev(), MASTER), 'planejamento');
  assert.equal(motivoForaDoLote(rev({ houve_desvio_programacao: true }), GESTAO), MSG_DESVIO_LOTE);
});

test('filtros rápidos e comparativo do desvio', () => {
  const lista = [rev(), rev({ id: 'd', houve_desvio_programacao: true }), fin(),
    { id: 'x', status_aprovacao: 'Aprovado', houve_desvio_programacao: true }];
  assert.deepEqual(contarFiltrosRapidos(lista), { todas: 4, 'aguardando-planejamento': 1, 'com-desvio': 2, desvioPendentes: 1 });
  assert.deepEqual(lista.filter((p) => passaFiltroRapido(p, 'com-desvio')).map((p) => p.id), ['d', 'x']);
  assert.deepEqual(comparativoDesvio({ obra_programada_ref: { nome: 'Obra Norte' }, obra: 'Usina Sul', status_operacional: 'Operação',
    categoria_desvio: { nome: 'Cliente' }, justificativa_desvio: ' ' }),
  { programado: 'Obra Norte', realizado: 'Usina Sul', categoria: 'Cliente', justificativa: null });
  assert.equal(comparativoDesvio({ obra_programada: 'Obra Norte', status_operacional: 'Manutenção Corretiva' }).realizado, 'Manutenção Corretiva');
});
