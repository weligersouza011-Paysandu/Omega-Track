// Fluxo completo da importação de Telemetria pela API real (Express + multer +
// requerAdmin + controller + parser), com o Prisma trocado por um banco em memória.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import XLSX from 'xlsx';
import { criarPrismaEmMemoria } from './helpers/prismaTelemetriaEmMemoria.mjs';

const banco = criarPrismaEmMemoria({
  veiculos: [{ tag: 'CA-0412', placa: 'QVN4G02' }, { tag: 'VAN-021', placa: 'SZI0F03' }],
  administradores: [{ id: '00000000-0000-4000-8000-000000000001', nome: 'Admin Teste', matricula: '90000' }],
});
globalThis.prisma = banco;

const { default: app } = await import('../src/app.js');
const { montarModeloTelemetria, COLUNAS_MODELO_TELEMETRIA } = await import('../frontend/src/utils/gerarModeloTelemetria.js');

const { assinarSessao } = await import('../src/middleware/sessao.js');
const AUTH = { Authorization: `Bearer ${assinarSessao({ id: '00000000-0000-4000-8000-000000000001', matricula: '90000', nome: 'Admin', tipo: 'ADMINISTRADOR', setor: 'GESTAO', nivel: 'MASTER' })}` };
let servidor;
let base;

before(async () => {
  servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  base = `http://127.0.0.1:${servidor.address().port}/api/telemetria`;
});
after(() => new Promise((resolve) => servidor.close(resolve)));

/** "dd/mm/aaaa hh:mm" em -03:00, `horasAtras` antes de agora. */
function dataLocal(horasAtras) {
  const d = new Date(Date.now() - horasAtras * 3600e3 - 3 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function xlsx(linhas) {
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([COLUNAS_MODELO_TELEMETRIA, ...linhas]), 'Modelo');
  return XLSX.write(livro, { type: 'buffer', bookType: 'xlsx' });
}

async function importar(buffer, confirmar, nome = 'telemetria.xlsx') {
  const formulario = new FormData();
  formulario.append('arquivo', new Blob([buffer]), nome);
  formulario.append('confirmar', String(confirmar));
  const resposta = await fetch(`${base}/importar`, { method: 'POST', headers: AUTH, body: formulario });
  return { status: resposta.status, corpo: await resposta.json() };
}

async function obter(caminho) {
  const resposta = await fetch(`${base}${caminho}`, { headers: AUTH });
  assert.equal(resposta.status, 200, caminho);
  return resposta.json();
}

test('a planilha modelo baixada é lida pelo parser (prévia não grava)', async () => {
  const livro = montarModeloTelemetria();
  assert.deepEqual(livro.SheetNames, ['Modelo', 'Instruções']);
  const [cabecalho, exemplo] = XLSX.utils.sheet_to_json(livro.Sheets.Modelo, { header: 1 });
  assert.deepEqual(cabecalho, COLUNAS_MODELO_TELEMETRIA);
  assert.deepEqual(exemplo, ['13/11/2026 08:30', 'ABC-1234', 'João Silva', 'Fadiga / Sono', 0, 0, 'Rodovia BR-155 Km 20', 'GRAVE']);

  const { status, corpo } = await importar(XLSX.write(livro, { type: 'buffer', bookType: 'xlsx' }), false, 'Modelo_Importacao_Telemetria.xlsx');
  assert.equal(status, 200);
  assert.equal(corpo.confirmado, false);
  assert.equal(corpo.total_eventos, 1);
  assert.deepEqual(corpo.por_evento, { 'Fadiga / Sono': 1 });
  assert.deepEqual(corpo.por_severidade, { GRAVE: 1 }, 'a severidade informada na planilha prevalece');
  assert.equal(corpo.amostra[0].localizacao, 'Rodovia BR-155 Km 20');
  assert.equal(corpo.amostra[0].data_hora, '2026-11-13T11:30:00.000Z');
  assert.deepEqual(corpo.placas_sem_veiculo, ['ABC-1234']);
  assert.equal(banco.eventos.length, 0, 'a prévia não grava nada');
});

test('fluxo completo: confirmar, reimportar sem duplicar, filtrar por tipo e ler os KPIs', async () => {
  const planilha = xlsx([
    [dataLocal(2), 'QVN4G02', 'JOAO DA SILVA', 'Excesso de Velocidade', 92, 80, 'BR-155 Km 12', ''], // +15% -> MODERADO
    [dataLocal(3), 'QVN4G02', 'JOAO DA SILVA', 'Excesso de Velocidade', 130, 80, 'BR-155 Km 14', ''], // >120 -> CRITICO
    [dataLocal(4), 'CA-0412', 'JOAO DA SILVA', 'Uso de Celular', 40, 60, 'Pátio Carajás', ''], // TAG no lugar da placa
    [dataLocal(5), 'SZI0F03', 'MARIA SOUZA', 'Freada de Emergência', 55, 60, 'PA-275', 'grave'],
    [dataLocal(6), 'SZI0F03', 'MARIA SOUZA', 'Arrancada Brusca', 20, 60, 'PA-275', ''],
    [dataLocal(30), 'SZI0F03', 'MARIA SOUZA', 'Fadiga / Sono', 0, 0, 'PA-160', ''], // janela anterior (24-48 h)
    [dataLocal(30), 'XYZ9Z99', 'SEM FROTA', 'Posição', 10, 60, 'PA-160', ''], // não é conduta
  ]);

  const previa = await importar(planilha, false);
  assert.equal(previa.corpo.total_eventos, 6);
  assert.equal(previa.corpo.linhas_sem_conduta, 1);

  const gravado = await importar(planilha, true);
  assert.equal(gravado.status, 200);
  assert.equal(gravado.corpo.confirmado, true);
  assert.equal(gravado.corpo.importados, 6);
  assert.equal(banco.logs.at(-1).acao, 'IMPORTAR_TELEMETRIA');

  const reimportado = await importar(planilha, true);
  assert.equal(reimportado.corpo.importados, 0);
  assert.equal(reimportado.corpo.duplicados_ignorados, 6);
  assert.equal(banco.eventos.length, 6);

  const celular = banco.eventos.find((e) => e.evento === 'Uso de Celular');
  assert.equal(celular.tag, 'CA-0412', 'TAG/PLACA com a TAG cruza com a frota');
  assert.equal(celular.severidade, 'CRITICO');
  assert.equal(banco.eventos.find((e) => e.valor === 92).tag, 'CA-0412', 'placa cruza com a frota');

  // Pílula "Uso de Celular"
  const soCelular = await obter(`?evento=${encodeURIComponent('Uso de Celular')}`);
  assert.equal(soCelular.paginacao.total, 1);
  // Pílula "Fadiga / Sono" (inclui a parada não cumprida) + janela de 24 h
  const fadiga24h = await obter(`?horas=24&evento=${encodeURIComponent('Fadiga / Sono,Fadiga sem Parada Obrigatória')}`);
  assert.equal(fadiga24h.paginacao.total, 0);
  const todos24h = await obter('?horas=24');
  assert.equal(todos24h.paginacao.total, 5);
  assert.equal(todos24h.eventos[0].valor, 92, 'mais recente primeiro');
  const velocidade = todos24h.eventos.filter((e) => e.evento === 'Excesso de Velocidade');
  assert.deepEqual(velocidade.map((e) => e.ocorrencia_no_mes), [1, 1], 'severidades diferentes contam separado');
  // Busca e severidade
  assert.equal((await obter('?busca=pa-275')).paginacao.total, 2);
  assert.equal((await obter('?severidade=GRAVE,CRITICO')).paginacao.total, 4);

  const resumo = await obter('/resumo?horas=24');
  assert.equal(resumo.dados_disponiveis.total, 6, 'dados existentes ignoram o filtro de período');
  const vazio = await obter('/resumo?horas=1');
  assert.equal(vazio.kpis.total, 0);
  assert.equal(vazio.dados_disponiveis.total, 6, 'período vazio, mas há dados: a tela oferece o atalho');
  assert.ok(new Date(vazio.dados_disponiveis.inicio) < new Date(vazio.dados_disponiveis.fim));
  assert.deepEqual(
    { total: resumo.kpis.total, graves: resumo.kpis.graves, fadiga: resumo.kpis.fadiga, velocidade: resumo.kpis.velocidade },
    { total: 5, graves: 3, fadiga: 0, velocidade: 2 },
  );
  assert.deepEqual(resumo.kpis.anterior, { total: 1, graves: 1, fadiga: 0, fadiga_veiculo_parado: 1, velocidade: 0 }, 'fadiga com o veículo parado fica à parte');
  assert.equal(resumo.top_veiculos[0].placa, 'QVN4G02');
  assert.equal(resumo.top_veiculos[0].graves, 1);
});

test('sem sessão administrativa a importação é recusada', async () => {
  const formulario = new FormData();
  formulario.append('arquivo', new Blob([xlsx([])]), 'x.xlsx');
  const resposta = await fetch(`${base}/importar`, { method: 'POST', body: formulario });
  assert.equal(resposta.status, 401);
});
