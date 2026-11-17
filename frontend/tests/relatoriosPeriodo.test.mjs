import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validarPeriodoRelatorios, carregarPartesDoPeriodo,
  planejarArquivosRelatorios, processarRelatoriosEmLotes,
} from '../src/utils/relatoriosPeriodo.js';

const sessao = { token: 'sessao-teste', usuario: { tipo: 'ADMINISTRADOR', matricula: '900' } };
const periodo = { dataInicio: '2026-11-01', dataFim: '2026-11-16' };
const parte = {
  id: 'parte-1', tag: 'JI-001', data: '2026-11-01T00:00:00.000Z',
  obra: 'Obra A', obra_id: 'obra-a', numero_relatorio: '0001',
  operador: '00123', funcionario: 'João Silva',
};
const resposta = (data, pages = 1) => ({ ok: true, json: async () => ({ data, pagination: { pages } }) });

test('período inclui um único dia e valida datas reais, bissextos e ordem', () => {
  assert.doesNotThrow(() => validarPeriodoRelatorios({ dataInicio: '2028-02-29', dataFim: '2028-02-29' }));
  for (const data of ['', '2026-02-29', '2026-02-30', '2026-99-01', '2026-11-31']) {
    assert.throws(() => validarPeriodoRelatorios({ dataInicio: data, dataFim: '2026-12-31' }), /Informe as datas/);
  }
  assert.throws(() => validarPeriodoRelatorios({ dataInicio: '2026-11-16', dataFim: '2026-11-01' }), /data final/);
});

test('seleção de status exige ao menos um status de aprovação válido', () => {
  assert.doesNotThrow(() => validarPeriodoRelatorios({ ...periodo, statuses: ['Aprovado', 'Revisado pelo Transporte'] }));
  for (const statuses of [[], ['inexistente'], ['Aprovado', 'Operação'], 'Aprovado', null]) {
    assert.throws(() => validarPeriodoRelatorios({ ...periodo, statuses }), /Selecione pelo menos um status/);
  }
});

test('consulta todas as páginas, inclui os limites e os status, sem duplicar relatórios', async (t) => {
  const chamadas = [];
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, opcoes) => {
    const params = new URL(url, 'http://localhost').searchParams;
    assert.equal(params.get('data_inicio'), periodo.dataInicio);
    assert.equal(params.get('data_fim'), periodo.dataFim);
    assert.equal(opcoes.headers.Authorization, 'Bearer sessao-teste');
    assert.equal(opcoes.signal, controller.signal);
    assert.equal(params.get('status'), null);
    assert.equal(params.get('operador'), null);
    chamadas.push(Number(params.get('page')));
    return Number(params.get('page')) === 1
      ? resposta(Array.from({ length: 100 }, (_, i) => ({ ...parte, id: `parte-${i}` })), 2)
      : resposta([
        parte, { ...parte, id: 'fim', data: '2026-11-16', status_aprovacao: 'Em Preenchimento' },
        { ...parte, id: 'fora', data: '2026-11-17' },
      ], 2);
  });
  const registros = await carregarPartesDoPeriodo(sessao, periodo, { signal: controller.signal });
  assert.equal(registros.length, 101);
  assert.ok(registros.some((p) => p.id === 'fim'));
  assert.ok(!registros.some((p) => p.id === 'fora'));
  assert.deepEqual(chamadas, [1, 2]);
});

test('operacional exporta apenas os próprios registros e uma sessão é obrigatória', async (t) => {
  const operacional = { token: 'operacional', usuario: { tipo: 'OPERACIONAL', matricula: '00123', nome: 'João Silva' } };
  t.mock.method(globalThis, 'fetch', async () => resposta([
    parte, { ...parte, id: 'outro', operador: '999', funcionario: 'Outra Pessoa' },
  ]));
  assert.deepEqual((await carregarPartesDoPeriodo(operacional, periodo)).map((p) => p.id), ['parte-1']);
  await assert.rejects(carregarPartesDoPeriodo({}, periodo), /Faça login/);
});

test('exportação combina os status selecionados com período, todas as páginas e acesso do operacional', async (t) => {
  const operacional = { token: 'operacional', usuario: { tipo: 'OPERACIONAL', matricula: '00123', nome: 'João Silva' } };
  const registros = [
    { ...parte, id: 'aprovado', status_aprovacao: 'Aprovado' },
    { ...parte, id: 'preenchendo', status_aprovacao: 'Em Preenchimento' },
    { ...parte, id: 'finalizado', status_aprovacao: 'Finalizado pelo Operador' },
    { ...parte, id: 'revisado', status_aprovacao: 'Revisado pelo Transporte', data: periodo.dataFim },
    { ...parte, id: 'legado', status: 'Aprovado' },
    { ...parte, id: 'outro', status_aprovacao: 'Aprovado', operador: '999', funcionario: 'Outra Pessoa' },
    { ...parte, id: 'fora', status_aprovacao: 'Aprovado', data: '2026-11-17' },
  ];
  const idsConsultados = [], processados = [];
  t.mock.method(globalThis, 'fetch', async (url, opcoes) => {
    if (opcoes.method === 'POST') {
      const { ids } = JSON.parse(opcoes.body);
      idsConsultados.push(...ids);
      return resposta(registros.filter((registro) => ids.includes(registro.id)));
    }
    const pagina = Number(new URL(url, 'http://localhost').searchParams.get('page'));
    return resposta(pagina === 1 ? registros.slice(0, 3) : registros.slice(3), 2);
  });
  const pacote = await processarRelatoriosEmLotes(operacional, {
    ...periodo, statuses: ['Aprovado', 'Revisado pelo Transporte'],
  }, { processarLote: async (arquivos, { total }) => {
    assert.equal(total, 3);
    processados.push(...arquivos.map((arquivo) => arquivo.relatorio.id));
  } });
  assert.deepEqual(idsConsultados.sort(), ['aprovado', 'legado', 'revisado']);
  assert.deepEqual(processados.sort(), ['aprovado', 'legado', 'revisado']);
  assert.equal(pacote.total, 3);
  const apenasFinalizados = await carregarPartesDoPeriodo(operacional, {
    ...periodo, statuses: ['Finalizado pelo Operador'],
  });
  assert.deepEqual(apenasFinalizados.map((registro) => registro.id), ['finalizado']);
});

test('nenhum relatório com os status escolhidos informa o filtro sem iniciar os lotes', async (t) => {
  let consultasLote = 0;
  t.mock.method(globalThis, 'fetch', async (_, opcoes) => {
    if (opcoes.method === 'POST') consultasLote += 1;
    return resposta([{ ...parte, status_aprovacao: 'Em Preenchimento' }]);
  });
  await assert.rejects(processarRelatoriosEmLotes(sessao, {
    ...periodo, statuses: ['Aprovado'],
  }), /Nenhum relatório encontrado para o período e os status selecionados/);
  assert.equal(consultasLote, 0);
});

test('pastas e arquivos permanecem distintos para obras homônimas e partes da mesma TAG/dia', () => {
  const plano = planejarArquivosRelatorios([
    parte, { ...parte, id: 'parte-2' },
    { ...parte, id: 'parte-3', obra_id: 'outra-obra' },
    { ...parte, id: 'parte-4', obra: null, obra_id: null },
    { ...parte, id: '../parte?5', obra: '../../Obra: A/', obra_id: 'obra-estranha' },
    { ...parte, id: 'parte-6', obra: 'CON', obra_id: 'obra-con' },
    { ...parte, id: 'parte-7', obra: '', obra_id: null, obra_ref: { id: 'obra-b', nome: 'Obra B' } },
  ]);
  assert.equal(new Set(plano.map((a) => a.caminho.toLowerCase())).size, 7);
  assert.equal(plano.find((a) => a.parte.id === 'parte-1').pasta, plano.find((a) => a.parte.id === 'parte-2').pasta);
  assert.notEqual(plano.find((a) => a.parte.id === 'parte-1').pasta, plano.find((a) => a.parte.id === 'parte-3').pasta);
  assert.equal(plano.find((a) => a.parte.id === 'parte-4').pasta, 'Sem obra');
  assert.equal(plano.find((a) => a.parte.id === 'parte-6').pasta, '_CON');
  assert.equal(plano.find((a) => a.parte.id === 'parte-7').pasta, 'Obra B');
  assert.ok(plano.every((a) => a.caminho.split('/').length === 2 && !a.caminho.startsWith('.')));
});

test('400 relatórios usam 4 páginas e 16 lotes completos, sem consultas individuais', async (t) => {
  const partes = Array.from({ length: 400 }, (_, i) => ({ ...parte, id: `parte-${String(i).padStart(3, '0')}`, obra: i < 200 ? 'Obra A' : 'Obra B' }));
  const chamadas = [], processados = [];
  t.mock.method(globalThis, 'fetch', async (url, opcoes) => {
    assert.equal(opcoes.headers.Authorization, 'Bearer sessao-teste');
    chamadas.push({ url, metodo: opcoes.method || 'GET' });
    if (opcoes.method === 'POST') {
      assert.equal(url, '/api/partes-diarias/exportacao/lote');
      const { ids } = JSON.parse(opcoes.body);
      assert.ok(ids.length <= 25);
      return resposta(partes.filter((p) => ids.includes(p.id)).reverse().map((p) => ({ ...p, fotos: [], assinaturas: [{ nome: 'Operador' }] })));
    }
    const pagina = Number(new URL(url, 'http://localhost').searchParams.get('page'));
    return resposta(partes.slice((pagina - 1) * 100, pagina * 100), 4);
  });
  const pacote = await processarRelatoriosEmLotes(sessao, periodo, {
    processarLote: async (arquivos, { total }) => {
      assert.equal(total, 400);
      assert.ok(arquivos.every((a) => a.relatorio.assinaturas[0].nome === 'Operador'));
      processados.push(...arquivos);
    },
  });
  assert.equal(chamadas.length, 20);
  assert.equal(chamadas.filter((c) => c.metodo === 'POST').length, 16);
  assert.equal(processados.length, 400);
  assert.equal(new Set(processados.map((a) => a.caminho)).size, 400);
  assert.equal(pacote.total, 400);
  assert.equal(pacote.nome, 'Relatorios_Oficiais_2026-11-01_a_2026-11-16.zip');
});

test('relatórios legados sem vínculo ficam na pasta da obra cadastrada de mesmo nome', () => {
  const plano = planejarArquivosRelatorios([parte, { ...parte, id: 'legado', obra_id: null }]);
  assert.equal(plano[0].pasta, plano[1].pasta);
});

test('período vazio e falha de página impedem o processamento parcial', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => resposta([]));
  await assert.rejects(processarRelatoriosEmLotes(sessao, periodo), /Nenhum relatório/);
  let chamadas = 0;
  t.mock.method(globalThis, 'fetch', async () => ++chamadas === 1 ? resposta([parte], 2) : { ok: false, status: 503 });
  await assert.rejects(processarRelatoriosEmLotes(sessao, periodo), /503/);
});

test('lote incompleto ou não autorizado não é enviado ao gerador', async (t) => {
  let processados = 0;
  t.mock.method(globalThis, 'fetch', async (_, opcoes) => resposta(opcoes.method === 'POST' ? [] : [parte]));
  await assert.rejects(processarRelatoriosEmLotes(sessao, periodo, {
    processarLote: async () => { processados += 1; },
  }), /lote está incompleto/);
  assert.equal(processados, 0);
});

test('cancelamento durante o lote impede concluir a exportação', async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => resposta([parte]));
  await assert.rejects(processarRelatoriosEmLotes(sessao, periodo, {
    signal: controller.signal, processarLote: async () => controller.abort(),
  }), { name: 'AbortError' });
});
