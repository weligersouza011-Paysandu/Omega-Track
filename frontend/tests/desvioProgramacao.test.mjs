import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avaliarDesvio, camposDesvioPayload, pendenciaDesvio } from '../src/utils/desvioProgramacao.js';

const programacao = { programada: true, obra: { id: 'obra-a', nome: 'Obra Norte' } };

test('sem programação no dia não há desvio', () => {
  assert.deepEqual(avaliarDesvio({ programada: false, obra: null }, { obraId: 'x' }),
    { programada: false, obraProgramada: null, desvio: false });
  assert.equal(avaliarDesvio(null, {}).desvio, false);
});

test('mesma obra = conforme; outra obra, sem obra ou status ≠ Operação = desvio', () => {
  assert.equal(avaliarDesvio(programacao, { obraId: 'obra-a' }).desvio, false);
  assert.equal(avaliarDesvio(programacao, { obraTexto: ' obra  norte ' }).desvio, false);
  assert.equal(avaliarDesvio(programacao, { obraId: 'obra-b' }).desvio, true);
  assert.equal(avaliarDesvio(programacao, {}).desvio, true);
  assert.equal(avaliarDesvio(programacao, { obraId: 'obra-a', statusOperacional: 'Manutenção Corretiva' }).desvio, true);
});

test('pendência exige categoria e justificativa com 10+ caracteres', () => {
  assert.equal(pendenciaDesvio({ desvio: false }), null);
  assert.match(pendenciaDesvio({ desvio: true }), /categoria e a justificativa/);
  assert.match(pendenciaDesvio({ desvio: true, categoriaId: 'c', justificativa: 'curta' }), /justificativa \(mín\. 10/);
  assert.equal(pendenciaDesvio({ desvio: true, categoriaId: 'c', justificativa: 'Cliente pediu apoio.' }), null);
});

test('payload: limpa sem desvio e não envia justificativa curta (autosave seguro)', () => {
  assert.deepEqual(camposDesvioPayload({ desvio: false, categoriaId: 'c', justificativa: 'qualquer coisa longa' }),
    { categoria_desvio_id: null, justificativa_desvio: null });
  assert.deepEqual(camposDesvioPayload({ desvio: true, categoriaId: 'c', justificativa: 'curta' }),
    { categoria_desvio_id: 'c', justificativa_desvio: null });
  assert.deepEqual(camposDesvioPayload({ desvio: true, categoriaId: 'c', justificativa: '  Cliente pediu apoio.  ' }),
    { categoria_desvio_id: 'c', justificativa_desvio: 'Cliente pediu apoio.' });
});
