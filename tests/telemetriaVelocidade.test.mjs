// Análise de Excesso de Velocidade pela API real, com banco em memória.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import XLSX from 'xlsx';
import { criarPrismaEmMemoria } from './helpers/prismaTelemetriaEmMemoria.mjs';

const banco = criarPrismaEmMemoria({
  veiculos: [{ tag: 'JI448', placa: 'QVV5H92' }, { tag: 'JI281', placa: 'GJN2B06' }],
  administradores: [{ id: '00000000-0000-4000-8000-000000000001', nome: 'Analista SSMA', matricula: '90000' }],
});
globalThis.prisma = banco;
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

const api = async (caminho, opcoes = {}) => {
  const r = await fetch(`${base}${caminho}`, { ...opcoes, headers: { ...AUTH, ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}) } });
  return { status: r.status, corpo: await r.json() };
};

// Formato da plataforma: "Velocidade acima do limite" + "Tempo total" (duração) por excesso.
const CAB = ['Nome da Origem', 'Data Equipamento', 'Data GPS', 'Placa', 'Cerca', 'Duração Vel. Excedida - s', 'Velocidade', 'Limite Km/h', 'Motorista', 'Endereço', 'Google Maps Link', 'Evento'];
const acima = (data, placa, mot, vel, lim, cerca = 'Cerca:#9') => ['x', data, data, placa, cerca, '', vel, lim, mot, 'pa-160', 'https://www.google.com/maps/?t=k&q=-6.06,-50.15', `Velocidade acima do limite dentro da cerca: Limite maximo: ${lim} Km/h`];
const tempo = (data, placa, mot, seg, lim, cerca = 'Cerca:#9') => ['x', data, data, placa, cerca, seg, lim - 5, lim, mot, 'pa-160', '', `Tempo total em velocidade maxima na cerca: Cerca: 9 - Tempo total: ${seg} (s)`];

test('fluxo da velocidade: ocorrências, gatilho de 10 s, faixas, recorrência, validação e plano', async () => {
  const linhas = [
    // João, Moderado (+20%), duas linhas no mesmo trecho (1 min) somando 12 s -> 1 ocorrência CONFIRMADA
    acima('03/11/2026 10:00', 'QVV5H92', 'JOAO SILVA', 60, 50), tempo('03/11/2026 10:00', 'QVV5H92', 'JOAO SILVA', 6, 50),
    acima('03/11/2026 10:01', 'QVV5H92', 'JOAO SILVA', 58, 50), tempo('03/11/2026 10:01', 'QVV5H92', 'JOAO SILVA', 6, 50),
    // João, Moderado, 5 s -> ABAIXO do gatilho
    acima('04/11/2026 11:00', 'QVV5H92', 'JOAO SILVA', 57, 50), tempo('04/11/2026 11:00', 'QVV5H92', 'JOAO SILVA', 5, 50),
    // João, Moderado de novo, 11 s -> 2º Moderado confirmado no mês
    acima('05/11/2026 12:00', 'QVV5H92', 'JOAO SILVA', 56, 50), tempo('05/11/2026 12:00', 'QVV5H92', 'JOAO SILVA', 11, 50),
    // João, Significativo (+30%), 10 s -> 1º Significativo (recorrência própria da faixa)
    acima('06/11/2026 13:00', 'QVV5H92', 'JOAO SILVA', 52, 40, 'Cerca:#16'), tempo('06/11/2026 13:00', 'QVV5H92', 'JOAO SILVA', 10, 40, 'Cerca:#16'),
    // Márcio, Crítico (+115%) por 9 s -> CONFIRMADA mesmo abaixo de 10 s; Comitê já no 1º
    acima('07/11/2026 14:00', 'GJN2B06', 'MARCIO SILVA', 86, 40, 'Cerca:#7'), tempo('07/11/2026 14:00', 'GJN2B06', 'MARCIO SILVA', 9, 40, 'Cerca:#7'),
    // Márcio, tolerância (+4%)
    acima('08/11/2026 15:00', 'GJN2B06', 'MARCIO SILVA', 52, 50), tempo('08/11/2026 15:00', 'GJN2B06', 'MARCIO SILVA', 30, 50),
  ];
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([CAB, ...linhas]), 'Telemetria');
  const f = new FormData();
  f.append('arquivo', new Blob([XLSX.write(livro, { type: 'buffer', bookType: 'xlsx' })]), 'vel.xlsx');
  f.append('confirmar', 'true');
  const imp = await fetch(`${base}/importar`, { method: 'POST', headers: AUTH, body: f }).then((r) => r.json());
  assert.equal(imp.importados, 7, 'as linhas de "Tempo total" viram duração, não eventos');

  let { corpo } = await api('/velocidade');
  assert.equal(corpo.kpis.linhas, 7);
  assert.equal(corpo.kpis.ocorrencias, 6, 'as duas linhas de 03/11 10:00-10:01 são um só excesso');
  assert.deepEqual(corpo.kpis.por_classificacao, { TOLERANCIA: 1, ABAIXO_GATILHO: 1, CONFIRMADA: 4, DESCARTADA: 0 });
  assert.deepEqual(corpo.kpis.confirmadas_por_faixa, { MODERADO: 2, GRAVE: 1, CRITICO: 1 });

  const porData = (d) => corpo.ocorrencias.find((o) => o.inicio.startsWith(d));
  const agrupada = porData('2026-11-03');
  assert.equal(agrupada.linhas.length, 2);
  assert.equal(agrupada.duracao_total_s, 12);
  assert.equal(agrupada.percentual_excesso, 20, 'vale o pior ponto');
  assert.equal(agrupada.tag, 'JI448');
  assert.equal(agrupada.medida, 'Advertência verbal');
  assert.equal(porData('2026-11-05').ocorrencia_no_mes, 2);
  assert.equal(porData('2026-11-05').medida, 'Advertência escrita');
  assert.equal(porData('2026-11-06').ocorrencia_no_mes, 1, 'Significativo conta na própria faixa');
  assert.equal(porData('2026-11-06').medida, 'Advertência escrita');
  const critico = porData('2026-11-07');
  assert.equal(critico.classificacao, 'CONFIRMADA');
  assert.equal(critico.duracao_total_s, 9);
  assert.match(critico.medida, /Comitê Pela Vida/);
  assert.equal(porData('2026-11-04').classificacao, 'ABAIXO_GATILHO');

  const marcio = corpo.ranking_condutores.find((r) => r.motorista === 'MARCIO SILVA');
  assert.equal(marcio.comite, true, 'Crítico leva ao Comitê');
  assert.equal(corpo.ranking_condutores[0].motorista, 'MARCIO SILVA');
  assert.equal(corpo.cercas[0].cerca, 'Cerca:#9');
  assert.equal(corpo.por_hora.find((h) => h.hora === 14).confirmadas, 1);
  assert.equal((await api('/velocidade?faixa=CRITICO')).corpo.ocorrencias.length, 1);

  // Validação da Central: confirmar o excesso abaixo do gatilho -> vira o 3º Moderado (Comitê)
  const abaixo = porData('2026-11-04');
  assert.equal((await api('/velocidade/validacao', { method: 'PATCH', body: JSON.stringify({ ids: abaixo.ids, decisao: 'DESCARTADA' }) })).status, 400);
  await api('/velocidade/validacao', { method: 'PATCH', body: JSON.stringify({ ids: abaixo.ids, decisao: 'CONFIRMADA' }) });
  ({ corpo } = await api('/velocidade'));
  assert.equal(porData('2026-11-04').ocorrencia_no_mes, 2);
  assert.equal(porData('2026-11-05').ocorrencia_no_mes, 3);
  assert.match(porData('2026-11-05').medida, /Comitê Pela Vida/);

  // Histórico do condutor conta ocorrências, não linhas
  const hist = (await api(`/motoristas/historico?motorista=${encodeURIComponent('JOAO SILVA')}`)).corpo;
  assert.equal(hist.ocorrencias_velocidade.length, 4);
  assert.deepEqual(
    { total: hist.resumo_mensal[0].velocidade, moderado: hist.resumo_mensal[0].velocidade_moderado, grave: hist.resumo_mensal[0].velocidade_grave },
    { total: 4, moderado: 3, grave: 1 },
  );

  // Plano de ação de velocidade
  const plano = await api('/planos', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'VELOCIDADE', motorista: 'JOAO SILVA', linha_matriz: 'VELOCIDADE_MODERADO', nivel_recorrencia: 3, eventos_ids: porData('2026-11-05').ids }),
  });
  assert.equal(plano.status, 201);
  assert.equal(plano.corpo.tipo, 'VELOCIDADE');
  assert.match(plano.corpo.medida_matriz, /Comitê Pela Vida/);
  assert.equal(plano.corpo.elegivel_prontidao, null);
  assert.equal((await api('/planos', { method: 'POST', body: JSON.stringify({ tipo: 'VELOCIDADE', motorista: 'JOAO SILVA', linha_matriz: 'FADIGA_VERDADEIRA' }) })).status, 400);
  ({ corpo } = await api('/velocidade'));
  assert.equal(porData('2026-11-05').plano_acao.status, 'ABERTO');
  assert.equal((await api('/planos?tipo=VELOCIDADE')).corpo.planos.length, 1);
});
