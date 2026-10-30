import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { carregarPartesDoDia, filtrarPartesDiarias } from '../src/utils/partesDiarias.js';
import { criarPlanilhaPartesDiarias } from '../src/utils/exportarPartesDiarias.js';

const usuario = { tipo: 'ADMINISTRADOR', matricula: '90000' };
const filtros = { data: '2026-10-29', status: 'todos', assinatura: 'todos', busca: '' };
const parte = {
  id: '1', operador: '00123', funcionario: 'João da Silva', tag: 'JI212',
  data: '2026-10-29T00:00:00.000Z', status_aprovacao: 'Aprovado', status_assinatura: 'ASSINADO',
  obra: 'Obra CT-251', obra_ref: { nome: 'Nome atualizado da obra' },
};

test('exportação busca todas as páginas do dia com autenticação e reaplica os filtros', async (t) => {
  const paginas = [];
  t.mock.method(globalThis, 'fetch', async (url, opcoes) => {
    const params = new URL(url, 'http://localhost').searchParams;
    assert.equal(params.get('data_inicio'), filtros.data);
    assert.equal(params.get('data_fim'), filtros.data);
    assert.equal(opcoes.headers.Authorization, 'Bearer teste');
    const pagina = Number(params.get('page'));
    paginas.push(pagina);
    const data = pagina === 1
      ? Array.from({ length: 100 }, (_, i) => ({ ...parte, id: String(i + 1) }))
      : [{ ...parte, id: '101' }, { ...parte, id: '102', status_assinatura: 'PENDENTE' },
        { ...parte, id: '103', data: '2026-10-28' }];
    return { ok: true, json: async () => ({ data, pagination: { pages: 2 } }) };
  });
  const resultado = await carregarPartesDoDia({ token: 'teste', usuario }, { ...filtros, assinatura: 'ASSINADO', busca: 'JI212' });
  assert.equal(resultado.length, 101);
  assert.equal(resultado.at(-1).id, '101');
  assert.deepEqual(paginas, [1, 2]);
});

test('falha em uma página impede uma exportação parcial', async (t) => {
  let chamadas = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    chamadas += 1;
    return chamadas === 1
      ? { ok: true, json: async () => ({ data: [parte], pagination: { pages: 2 } }) }
      : { ok: false, status: 503 };
  });
  await assert.rejects(carregarPartesDoDia({ usuario }, filtros), /503/);
});

test('filtros combinados e visibilidade do operacional permanecem iguais aos da tela', () => {
  const registros = [parte, { ...parte, id: '2', operador: '99999', funcionario: 'Outra pessoa' },
    { ...parte, id: '3', status_aprovacao: 'Em Preenchimento' }];
  const operacional = { tipo: 'OPERACIONAL', matricula: '00123', nome: 'João da Silva' };
  const resultado = filtrarPartesDiarias(registros, operacional, { ...filtros, status: 'Aprovado', assinatura: 'ASSINADO' });
  assert.deepEqual(resultado.map((p) => p.id), ['1']);
  assert.equal(filtrarPartesDiarias(registros, usuario, { ...filtros, busca: 'inexistente' }).length, 0);
});

test('Excel preserva as cinco colunas, obra, zeros, texto literal e data sem deslocamento de fuso', async () => {
  const workbook = criarPlanilhaPartesDiarias([parte,
    { ...parte, funcionario: '=1+1', operador: '00001', obra: '' },
    { ...parte, obra: null, obra_ref: null },
  ], filtros);
  const recarregado = new ExcelJS.Workbook();
  await recarregado.xlsx.load(await workbook.xlsx.writeBuffer());
  const aba = recarregado.getWorksheet('Partes Diárias');
  assert.deepEqual(aba.getRow(4).values.slice(1), ['Matrícula do operador', 'Nome do operador', 'TAG do veículo', 'Data', 'Nome da obra']);
  assert.equal(aba.getCell('A5').value, '00123');
  assert.equal(aba.getCell('B5').value, 'João da Silva');
  assert.equal(aba.getCell('C5').value, 'JI212');
  assert.equal(aba.getCell('D5').value.toISOString(), '2026-10-29T00:00:00.000Z');
  assert.equal(aba.getCell('D5').numFmt, 'dd/mm/yyyy');
  assert.equal(aba.getCell('B6').value, '=1+1');
  assert.equal(aba.getCell('B6').type, ExcelJS.ValueType.String);
  assert.equal(aba.getCell('E5').value, 'Obra CT-251');
  assert.equal(aba.getCell('E6').value, 'Nome atualizado da obra');
  assert.ok(!aba.getCell('E7').value);
  assert.equal(aba.pageSetup.printArea, 'A1:E7');
  assert.ok(aba.getTable('PartesDiarias'));
  assert.equal(aba.rowCount, 7);
  assert.equal(aba.views[0].ySplit, 4);
});
