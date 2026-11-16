import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import {
  validarPeriodoRelatorios, carregarPartesDoPeriodo,
  planejarArquivosRelatorios, criarPacoteRelatorios,
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

test('ZIP contém um PDF por relatório, com detalhes completos e pastas por obra', async (t) => {
  const lista = [parte, { ...parte, id: 'parte-2' }, { ...parte, id: 'parte-3', obra: 'Obra B', obra_id: 'obra-b' }];
  const renderizados = [];
  const progresso = [];
  t.mock.method(globalThis, 'fetch', async (url, opcoes) => {
    assert.equal(opcoes.headers.Authorization, 'Bearer sessao-teste');
    if (url.includes('?')) return resposta(lista);
    const atual = lista.find((p) => url.endsWith(p.id));
    return resposta({ ...atual, assinaturas: [{ nome: 'Operador' }], fotos: [{ url: '/foto.png' }], atividades: [{ descricao: 'Atividade oficial' }] });
  });
  const pacote = await criarPacoteRelatorios(sessao, periodo, {
    gerarPdf: async (completo) => {
      assert.equal(completo.assinaturas[0].nome, 'Operador');
      assert.equal(completo.fotos.length, 1);
      assert.equal(completo.atividades[0].descricao, 'Atividade oficial');
      renderizados.push(completo.id);
      return new TextEncoder().encode(`%PDF-1.4\n${completo.id}\n%%EOF`);
    },
    onProgresso: (atual) => progresso.push(atual),
  });
  const zip = await JSZip.loadAsync(pacote.conteudo);
  const arquivos = Object.values(zip.files).filter((arquivo) => !arquivo.dir);
  assert.equal(arquivos.length, 3);
  assert.equal(arquivos.filter((arquivo) => arquivo.name.startsWith('Obra A/')).length, 2);
  assert.equal(arquivos.filter((arquivo) => arquivo.name.startsWith('Obra B/')).length, 1);
  for (const arquivo of arquivos) assert.match(await arquivo.async('string'), /^%PDF-1\.4/);
  assert.deepEqual(renderizados, ['parte-1', 'parte-2', 'parte-3']);
  assert.equal(pacote.total, 3);
  assert.equal(pacote.obras, 2);
  assert.equal(pacote.nome, 'Relatorios_Oficiais_2026-11-01_a_2026-11-16.zip');
  assert.ok(progresso.some((p) => p.etapa === 'gerando' && p.total === 3));
  assert.equal(progresso.at(-1).percentual, 100);
});

test('relatórios legados sem vínculo ficam na mesma pasta da obra cadastrada de mesmo nome', () => {
  const plano = planejarArquivosRelatorios([parte, { ...parte, id: 'legado', obra_id: null }]);
  assert.equal(plano[0].pasta, plano[1].pasta);
});

test('período vazio e falha na segunda página não produzem um pacote parcial', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => resposta([]));
  await assert.rejects(criarPacoteRelatorios(sessao, periodo), /Nenhum relatório/);
  let chamadas = 0;
  t.mock.method(globalThis, 'fetch', async () => ++chamadas === 1
    ? resposta([parte], 2) : { ok: false, status: 503 });
  await assert.rejects(criarPacoteRelatorios(sessao, periodo), /503/);
  assert.equal(chamadas, 2);
});

test('falha em um PDF interrompe o lote e identifica a obra e o relatório', async (t) => {
  let renderizados = 0;
  t.mock.method(globalThis, 'fetch', async (url) => url.includes('?')
    ? resposta([parte, { ...parte, id: 'parte-2' }]) : resposta(parte));
  await assert.rejects(criarPacoteRelatorios(sessao, periodo, {
    gerarPdf: async () => { renderizados += 1; throw new Error('Assinatura indisponível.'); },
  }), /Obra A.*JI-001.*Assinatura indisponível.*Nenhum ZIP/);
  assert.equal(renderizados, 1);
});

test('cancelar durante a geração impede o ZIP e não consulta o próximo relatório', async (t) => {
  const controller = new AbortController();
  const detalhes = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('?')) return resposta([parte, { ...parte, id: 'parte-2' }]);
    detalhes.push(url);
    return resposta(parte);
  });
  await assert.rejects(criarPacoteRelatorios(sessao, periodo, {
    signal: controller.signal,
    gerarPdf: async () => { controller.abort(); return new Uint8Array(); },
  }), { name: 'AbortError' });
  assert.equal(detalhes.length, 1);
});
