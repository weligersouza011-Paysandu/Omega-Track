import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { criarDocumentoParteDiaria, gerarPdfParteDiariaNativo } from '../src/utils/pdfParteDiariaNativo.js';
import { criarCacheImagensPdf } from '../src/utils/imagensRelatorioPdf.js';
import { criarMotorRelatoriosPdf } from '../src/utils/motorRelatoriosPdf.js';
import { montarModeloRelatorio } from '../src/utils/modeloRelatorioParteDiaria.js';

const parte = {
  id: 'parte-1', numero_relatorio: 'QA-001', data: '2026-11-01', tag: 'QA-001',
  obra: 'Obra Principal', contratante: 'Contratante QA', funcionario: 'Operador Original', operador: '00001',
  funcao: 'Motorista', horario_entrada: '07:00', horario_saida: '17:00', intervalo_entrada: '12:00', intervalo_saida: '13:00',
  km_inicial: 0, km_final: 150, status_operacional: 'Operação', status_relatorio: 'APROVADO',
  mao_obra: [{ nome: 'Nome posterior', matricula: '99999', funcao: 'Outra função' }],
  atividades: [{ descricao: 'Atividade oficial preservada', status: 'Concluído' }], ocorrencias: [], fotos: [], assinaturas: [],
};

function textoPdf(buffer) {
  const bruto = Buffer.from(buffer).toString('latin1');
  let texto = bruto;
  for (const correspondencia of bruto.matchAll(/stream\r?\n/g)) {
    const inicio = correspondencia.index + correspondencia[0].length;
    const fim = bruto.indexOf('\nendstream', inicio);
    if (fim < 0) continue;
    try { texto += inflateSync(Buffer.from(bruto.slice(inicio, fim), 'latin1')).toString('latin1'); } catch { /* imagem JPEG ou stream sem compressão */ }
  }
  return texto;
}

test('PDF nativo preserva texto pesquisável, autor original, zeros, horários e dados oficiais', () => {
  const bytes = gerarPdfParteDiariaNativo(parte);
  const texto = textoPdf(bytes);
  assert.match(Buffer.from(bytes).toString('ascii', 0, 8), /^%PDF-/);
  for (const campo of ['Obra Principal', 'Operador Original', '00001', '09:00', 'KM Inicial', 'Atividade oficial preservada', 'QA-001']) {
    assert.ok(texto.includes(campo), `Campo ausente: ${campo}`);
  }
  assert.ok(!texto.includes('Nome posterior'));
  assert.ok(!texto.includes('/Subtype /Image'), 'relatório sem fotos não deve ser uma imagem de página');
  assert.equal(montarModeloRelatorio(parte).km_inicial, 0);
});

test('ônibus e van são aprovados no Transporte e jornadas noturnas mantêm cálculo correto', () => {
  const modelo = montarModeloRelatorio({ ...parte, status_relatorio: 'REVISAO', veiculo: { modelo: 'Ônibus' },
    assinaturas: [{ etapa: 'TRANSPORTE' }], horario_entrada: '22:00', horario_saida: '06:00', intervalo_entrada: '00:00', intervalo_saida: '01:00' });
  assert.equal(modelo.statusLabel, 'Aprovado');
  assert.equal(modelo.horas, '07:00');
});

test('textos e tabelas extensos continuam em outras páginas sem perder o final do conteúdo', () => {
  const longo = { ...parte, atividades: [{ descricao: 'Descrição detalhada '.repeat(1400) + ' FIM-LONGO', status: 'Pendente' }],
    ocorrencias: Array.from({ length: 70 }, (_, i) => ({ tipo: 'Informativa', descricao: `Ocorrencia-${i}` })) };
  const documento = criarDocumentoParteDiaria(longo);
  assert.ok(documento.getNumberOfPages() > 3);
  const texto = textoPdf(documento.output('arraybuffer'));
  assert.ok(texto.includes('FIM-LONGO'));
  assert.ok(texto.includes('Ocorrencia-69'));
});

test('cache reutiliza mídia repetida, limita concorrência e permite repetir falha de rede', async () => {
  let ativas = 0, pico = 0, chamadas = 0, falhar = true;
  const cache = criarCacheImagensPdf({ concorrencia: 2, carregar: async (url) => {
    chamadas += 1; ativas += 1; pico = Math.max(pico, ativas);
    await new Promise((resolve) => setTimeout(resolve, 3));
    ativas -= 1;
    if (url === 'erro' && falhar) throw new Error('Rede');
    return { dados: new Uint8Array(16), largura: 1, altura: 1 };
  } });
  const repetida = await Promise.all([cache.obter('a'), cache.obter('a'), cache.obter('b'), cache.obter('c')]);
  assert.equal(chamadas, 3);
  assert.equal(repetida[0], repetida[1]);
  assert.ok(pico <= 2);
  await assert.rejects(cache.obter('erro'), /Rede/);
  falhar = false;
  assert.ok(await cache.obter('erro'));
});

test('ZIP do motor contém PDFs individuais completos e reutiliza logo, foto e assinatura', async () => {
  const dados = new Uint8Array(await readFile(new URL('../public/favicon-16x16.png', import.meta.url)));
  const carregadas = [];
  const cache = criarCacheImagensPdf({ carregar: async (url) => {
    carregadas.push(url);
    return { dados, largura: 16, altura: 16, formato: 'PNG' };
  } });
  const progresso = [];
  const motor = criarMotorRelatoriosPdf({ cacheImagens: cache, onProgresso: (p) => progresso.push(p) });
  const arquivos = Array.from({ length: 3 }, (_, i) => ({ obra: i < 2 ? 'Obra A' : 'Obra B',
    caminho: `${i < 2 ? 'Obra A' : 'Obra B'}/Parte-${i}.pdf`, relatorio: {
      ...parte, id: `parte-${i}`, numero_relatorio: `QA-${i}`,
      fotos: [{ url: 'foto', legenda: 'Evidência preservada' }],
      assinaturas: [{ etapa: 'OPERADOR', nome: 'Assinante', assinatura_dado: 'assinatura', assinado_em: '2026-11-01T17:00:00Z' }],
    } }));
  await motor.processarLote(arquivos.slice(0, 2), 3);
  await assert.rejects(motor.finalizar(), /não foi concluído/);
  await motor.processarLote(arquivos.slice(2), 3);
  const zip = await JSZip.loadAsync(await motor.finalizar());
  const pdfs = Object.values(zip.files).filter((arquivo) => !arquivo.dir);
  assert.equal(pdfs.length, 3);
  for (const pdf of pdfs) {
    const texto = textoPdf(await pdf.async('uint8array'));
    assert.ok(texto.includes('Atividade oficial preservada'));
    assert.ok(texto.includes('Assinante'));
    assert.ok(texto.includes('/Subtype /Image'));
  }
  assert.deepEqual(carregadas.sort(), ['/logo/0.png', 'assinatura', 'foto']);
  assert.equal(progresso.at(-1).percentual, 100);
});

test('cache descarta mídia antiga ao alcançar o limite de memória', async () => {
  let chamadas = 0;
  const cache = criarCacheImagensPdf({ limiteBytes: 20, carregar: async () => {
    chamadas += 1; return { dados: new Uint8Array(16), largura: 1, altura: 1 };
  } });
  await cache.obter('a'); await cache.obter('b'); await cache.obter('a');
  assert.equal(chamadas, 3);
});

test('legenda extensa da foto é preservada em páginas de continuação', async () => {
  const dados = new Uint8Array(await readFile(new URL('../public/favicon-16x16.png', import.meta.url)));
  const bytes = gerarPdfParteDiariaNativo({ ...parte, fotos: [{ url: 'foto', legenda: 'Legenda detalhada '.repeat(600) + ' FIM-LEGENDA' }] }, {
    imagens: { foto: { dados, largura: 16, altura: 16, formato: 'PNG' } },
  });
  assert.ok(textoPdf(bytes).includes('FIM-LEGENDA'));
});
