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

test('pendência exige só a categoria; justificativa é opcional', () => {
  assert.equal(pendenciaDesvio({ desvio: false }), null);
  assert.match(pendenciaDesvio({ desvio: true }), /selecione a categoria/);
  assert.match(pendenciaDesvio({ desvio: true, justificativa: 'Texto longo o bastante' }), /selecione a categoria/);
  assert.equal(pendenciaDesvio({ desvio: true, categoriaId: 'c' }), null);
});

test('payload: limpa sem desvio; justificativa curta ou vazia é aceita', () => {
  assert.deepEqual(camposDesvioPayload({ desvio: false, categoriaId: 'c', justificativa: 'qualquer coisa longa' }),
    { categoria_desvio_id: null, justificativa_desvio: null });
  assert.deepEqual(camposDesvioPayload({ desvio: true, categoriaId: 'c', justificativa: ' curta ' }),
    { categoria_desvio_id: 'c', justificativa_desvio: 'curta' });
  assert.deepEqual(camposDesvioPayload({ desvio: true, categoriaId: 'c', justificativa: '   ' }),
    { categoria_desvio_id: 'c', justificativa_desvio: null });
  assert.deepEqual(camposDesvioPayload({ desvio: true, categoriaId: 'c', justificativa: '  Cliente pediu apoio.  ' }),
    { categoria_desvio_id: 'c', justificativa_desvio: 'Cliente pediu apoio.' });
});
