// Filtro por semana do ano (ISO, -03:00) na API de Telemetria, com banco em memória.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import XLSX from 'xlsx';
import { criarPrismaEmMemoria } from './helpers/prismaTelemetriaEmMemoria.mjs';
import { intervaloDaSemana, semanaISO } from '../src/utils/semanasTelemetria.js';

globalThis.prisma = criarPrismaEmMemoria({
  administradores: [{ id: '00000000-0000-4000-8000-000000000001', nome: 'Analista', matricula: '90000' }],
});
const { default: app } = await import('../src/app.js');

const { assinarSessao } = await import('../src/middleware/sessao.js');
const AUTH = { Authorization: `Bearer ${assinarSessao({ id: '00000000-0000-4000-8000-000000000001', matricula: '90000', nome: 'Admin', tipo: 'ADMINISTRADOR', setor: 'GESTAO', nivel: 'MASTER' })}` };
let base;
let servidor;
before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api/telemetria`;
});
after(() => new Promise((r) => servidor.close(r)));

const obter = async (caminho) => {
  const r = await fetch(`${base}${caminho}`, { headers: AUTH });
  return { status: r.status, corpo: await r.json() };
};

test('semana ISO no horário de Brasília', () => {
  assert.equal(semanaISO('2026-11-02T03:00:00Z').chave, '2026-45', 'segunda 02/11 00:00 (-03:00)');
  assert.equal(semanaISO('2026-11-02T02:59:00Z').chave, '2026-44', 'ainda domingo 01/11 em -03:00');
  assert.equal(semanaISO('2027-01-01T13:00:00Z').chave, '2026-53', '2026 tem 53 semanas');
  assert.equal(intervaloDaSemana('2026-45').inicio.toISOString(), '2026-11-02T03:00:00.000Z');
  assert.equal(intervaloDaSemana('2025-53'), null, '2025 não tem semana 53');
});

test('lista as semanas com registro e filtra por elas mantendo a recorrência do mês', async () => {
  const CAB = ['Nome da Origem', 'Data Equipamento', 'Data GPS', 'Placa', 'Cerca', 'Duração Vel. Excedida - s', 'Velocidade', 'Limite Km/h', 'Motorista', 'Endereço', 'Google Maps Link', 'Evento'];
  const acima = (data, vel) => ['x', data, data, 'QVV5H92', 'Cerca:#9', 12, vel, 50, 'JOAO SILVA', 'pa-160', '', 'Velocidade acima do limite dentro da cerca: Limite maximo: 50 Km/h'];
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([CAB,
    acima('28/10/2026 10:00', 58), // semana 44 (outubro: outra contagem mensal)
    acima('01/11/2026 10:00', 58), // semana 44, 1º Moderado de novembro
    acima('03/11/2026 10:00', 58), // semana 45, 2º Moderado de novembro
    acima('04/11/2026 10:00', 52), // semana 45, tolerância
    acima('10/11/2026 10:00', 70), // semana 46, Significativo
  ]), 'Telemetria');
  const f = new FormData();
  f.append('arquivo', new Blob([XLSX.write(livro, { type: 'buffer', bookType: 'xlsx' })]), 'semanas.xlsx');
  f.append('confirmar', 'true');
  const imp = await fetch(`${base}/importar`, { method: 'POST', headers: AUTH, body: f }).then((r) => r.json());
  assert.equal(imp.importados, 5);

  const { corpo: semanas } = await obter('/semanas');
  assert.deepEqual(semanas.semanas.map((s) => [s.chave, s.total]), [['2026-46', 1], ['2026-45', 2], ['2026-44', 2]]);
  assert.deepEqual(semanas.padrao, ['2026-46', '2026-45'], 'padrão = as duas últimas semanas com registro');
  assert.equal(semanas.semanas[1].inicio, '2026-11-02T03:00:00.000Z');

  assert.equal((await obter('/?semanas=2026-45')).corpo.paginacao.total, 2);
  assert.equal((await obter('/?semanas=2026-44,2026-46')).corpo.paginacao.total, 3, 'semanas não contíguas');
  assert.equal((await obter('/?semanas=2026-99')).status, 400);

  const resumo = (await obter('/resumo?semanas=2026-46,2026-45')).corpo;
  assert.equal(resumo.kpis.total, 3);
  assert.deepEqual(resumo.kpis.semanas, ['2026-45', '2026-46']);
  assert.equal(resumo.kpis.anterior.total, 2, 'compara com as 2 semanas anteriores (43 e 44)');

  const velocidade = (await obter('/velocidade?semanas=2026-45')).corpo;
  assert.equal(velocidade.ocorrencias.length, 2, 'só as ocorrências da semana 45 aparecem');
  const moderado = velocidade.ocorrencias.find((o) => o.faixa === 'MODERADO');
  assert.equal(moderado.ocorrencia_no_mes, 2, 'o 1º de novembro (semana 44) conta na recorrência');
  assert.equal(moderado.medida, 'Advertência escrita');
});
