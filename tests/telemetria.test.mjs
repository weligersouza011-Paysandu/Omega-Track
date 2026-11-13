import assert from 'node:assert/strict';
import { test } from 'node:test';
import XLSX from 'xlsx';
import * as regras from '../src/utils/classificacaoTelemetria.js';
import {
  chavePlaca,
  dataDaCelula,
  extrairEventos,
  lerLinhas,
  parouAposFadiga,
} from '../src/services/telemetriaPlanilhaService.js';
import { calcularOcorrencias, montarFiltro } from '../src/controllers/telemetriaController.js';

const { EVENTOS } = regras;
const CABECALHO = ['Nome da Origem', 'Data Equipamento', 'Data GPS', 'Placa', 'Cerca', 'Duração Vel. Excedida - s',
  'Velocidade', 'Limite Km/h', 'Motorista', 'Endereço', 'Google Maps Link', 'Evento'];

/** Planilha em memória no formato da plataforma (datas como texto dd/mm/aaaa, em -03:00). */
function planilha(linhas) {
  const aba = XLSX.utils.aoa_to_sheet([CABECALHO, ...linhas.map((l) => [
    'x.xlsx', l.data, l.data, l.placa ?? 'QVN4G02 CT-251', l.cerca ?? 'Cerca:#9', l.duracao ?? null, l.vel ?? 0,
    l.limite ?? 50, l.motorista ?? 'JOAO DA SILVA', 'parauapebas - pa', 'https://www.google.com/maps/?t=k&q=-6.05,-50.12', l.evento,
  ])]);
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, aba, 'Telemetria');
  return XLSX.write(livro, { type: 'buffer', bookType: 'xlsx' });
}

test('classifica os textos da plataforma e ignora o que não é conduta', () => {
  assert.deepEqual(regras.classificarTexto('Sensor de fadiga: Fadiga detectada'), { evento: EVENTOS.FADIGA });
  assert.equal(regras.classificarTexto('Sensor de fadiga: Cadastro motorista'), null);
  assert.equal(regras.classificarTexto('Operadora Celular: VIVO'), null, 'operadora não é uso de celular');
  assert.equal(regras.classificarTexto('Posição'), null);
  assert.equal(regras.classificarTexto('Ignição Off'), null);
  assert.deepEqual(regras.classificarTexto('Excedeu Velocidade Máxima: 15 s'), { evento: EVENTOS.VELOCIDADE, duracao_s: 15 });
  assert.deepEqual(
    regras.classificarTexto('Tempo total em velocidade maxima na cerca: Cerca: 9 - Tempo total: 6 (s)'),
    { auxiliar: 'DURACAO_VELOCIDADE', duracao_s: 6 },
  );
  assert.equal(regras.classificarTexto('Uso de celular durante a condução').evento, EVENTOS.CELULAR);
  assert.equal(regras.classificarTexto('Freada brusca').evento, EVENTOS.FREADA);
  assert.equal(regras.classificarTexto('Arrancada brusca').evento, EVENTOS.ARRANCADA);
  assert.equal(regras.limiteDoTexto('Velocidade acima do limite dentro da cerca: Limite maximo: 50 Km/h'), 50);
});

test('faixas de velocidade do Anexo I', () => {
  assert.equal(regras.severidadeVelocidade(53, 50).severidade, 'NORMAL'); // +6%: tolerância
  assert.equal(regras.severidadeVelocidade(54, 50).severidade, 'MODERADO'); // +8%
  assert.equal(regras.severidadeVelocidade(60, 50).severidade, 'MODERADO'); // +20%
  assert.equal(regras.severidadeVelocidade(61, 50).severidade, 'GRAVE'); // +22%
  assert.equal(regras.severidadeVelocidade(75, 50).severidade, 'GRAVE'); // +50%
  assert.equal(regras.severidadeVelocidade(76, 50).severidade, 'CRITICO'); // +52%
  assert.equal(regras.severidadeVelocidade(121, 110).severidade, 'CRITICO'); // >120 km/h
  assert.equal(regras.severidadeVelocidade(61, 50).classificacao, 'N3');
});

test('medida recomendada por recorrência no mês', () => {
  assert.equal(regras.medidaRecomendada(EVENTOS.VELOCIDADE, 'MODERADO', 1), 'Advertência verbal');
  assert.equal(regras.medidaRecomendada(EVENTOS.VELOCIDADE, 'GRAVE', 2), 'Suspensão de RAC');
  assert.match(regras.medidaRecomendada(EVENTOS.VELOCIDADE, 'MODERADO', 5), /Comitê Pela Vida/);
  assert.match(regras.medidaRecomendada(EVENTOS.VELOCIDADE, 'CRITICO', 1), /SSO local/, 'célula vazia na matriz');
  assert.equal(regras.medidaRecomendada(EVENTOS.VELOCIDADE, 'NORMAL', 1), null);
});

test('placa da plataforma com contrato cruza com a frota', () => {
  assert.equal(chavePlaca('QVN4G02 CT-251'), 'QVN4G02');
  assert.equal(chavePlaca('qvn-4g02'), 'QVN4G02');
  assert.equal(dataDaCelula('03/11/2026 08:15:00').toISOString(), '2026-11-03T11:15:00.000Z');
});

test('planilha: excesso com duração, fadiga sem parada e TAG pela placa', () => {
  const buffer = planilha([
    { data: '03/11/2026 08:00:00', vel: 40, evento: 'Posição' },
    { data: '03/11/2026 08:01:00', vel: 61, evento: 'Velocidade acima do limite dentro da cerca: Limite maximo: 50 Km/h' },
    { data: '03/11/2026 08:01:20', vel: 45, evento: 'Tempo total em velocidade maxima na cerca: Cerca: 9 - Tempo total: 12 (s)' },
    { data: '03/11/2026 09:00:00', vel: 55, evento: 'Sensor de fadiga: Fadiga detectada' },
    { data: '03/11/2026 09:06:00', vel: 60, evento: 'Posição' },
    { data: '03/11/2026 09:12:00', vel: 58, evento: 'Posição' },
    { data: '03/11/2026 09:20:00', vel: 50, evento: 'Posição' },
    { data: '03/11/2026 09:20:00', vel: 50, evento: 'Operadora Celular: VIVO' },
  ]);
  const frota = new Map([['QVN4G02', { tag: 'CA-0123' }]]);
  const { eventos, fadiga, ignoradas } = extrairEventos(lerLinhas(buffer), { veiculosPorPlaca: frota });

  const excesso = eventos.find((e) => e.evento === EVENTOS.VELOCIDADE);
  assert.equal(excesso.severidade, 'GRAVE');
  assert.equal(excesso.duracao_s, 12, 'a duração vem do evento "Tempo total"');
  assert.equal(excesso.tag, 'CA-0123');
  assert.equal(excesso.latitude, -6.05);

  assert.deepEqual(fadiga, { total: 1, veiculo_parado: 0, sem_parada: 1, indeterminadas: 0 });
  const semParada = eventos.find((e) => e.evento === EVENTOS.FADIGA_SEM_PARADA);
  assert.equal(semParada.origem, 'DERIVADO');
  assert.equal(semParada.data_hora.toISOString(), '2026-11-03T12:15:00.000Z');
  assert.equal(eventos.length, 3);
  assert.equal(ignoradas, 5);
});

test('fadiga seguida de parada de 5 min conta como parada cumprida', () => {
  const t0 = Date.UTC(2026, 10, 3, 12);
  const leituras = [0, 4, 6, 9, 12].map((min, i) => ({ t: t0 + min * 60000, velocidade: i < 2 ? 30 : 0, texto: 'posicao' }));
  assert.equal(parouAposFadiga(leituras, t0), true);
  assert.equal(parouAposFadiga([{ t: t0, velocidade: 40, texto: 'posicao' }], t0), null, 'sem leituras depois: indeterminado');
  // Planilha sem rastreamento: a próxima leitura horas depois não prova que ele seguiu rodando.
  assert.equal(parouAposFadiga([{ t: t0, velocidade: 40, texto: 'fadiga' }, { t: t0 + 5 * 3600e3, velocidade: 60, texto: 'freada' }], t0), null);
  assert.equal(parouAposFadiga([{ t: t0, velocidade: 40, texto: 'fadiga' }, { t: t0 + 18 * 60000, velocidade: 60, texto: 'posicao' }], t0), false);
});

test('recorrência conta por motorista, tipo, severidade e mês', () => {
  const base = { motorista: 'JOAO', evento: EVENTOS.VELOCIDADE, severidade: 'MODERADO' };
  const ocorrencias = calcularOcorrencias([
    { ...base, id: 'a', data_hora: '2026-10-31T12:00:00Z' },
    { ...base, id: 'b', data_hora: '2026-11-01T12:00:00Z' },
    { ...base, id: 'c', data_hora: '2026-11-02T12:00:00Z' },
    { ...base, id: 'd', data_hora: '2026-11-03T12:00:00Z', severidade: 'NORMAL' },
  ]);
  assert.equal(ocorrencias.get('a'), 1);
  assert.equal(ocorrencias.get('c'), 2, 'outubro não soma em novembro');
  assert.equal(ocorrencias.has('d'), false);
});

test('filtros da tela: busca, janela em horas e validação', () => {
  const agora = new Date('2026-11-13T15:00:00Z');
  const where = montarFiltro({ busca: 'QVN', horas: '24', severidade: 'grave,critico' }, agora);
  assert.equal(where.OR.length, 4);
  assert.deepEqual(where.severidade, { in: ['GRAVE', 'CRITICO'] });
  assert.equal(where.data_hora.gte.toISOString(), '2026-11-12T15:00:00.000Z');
  assert.throws(() => montarFiltro({ evento: 'Inexistente' }), /Valor invalido/);
  assert.throws(() => montarFiltro({ horas: '-1' }), /horas/);
});
