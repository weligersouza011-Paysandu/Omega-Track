// Análise de Fadiga Detectada e Planos de Ação pela API real, com banco em memória.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import XLSX from 'xlsx';
import { criarPrismaEmMemoria } from './helpers/prismaTelemetriaEmMemoria.mjs';
import { agruparOcorrenciasFadiga, classificarTexto, medidaFadiga } from '../src/utils/classificacaoTelemetria.js';

const banco = criarPrismaEmMemoria({
  veiculos: [{ tag: 'CA-0388', placa: 'GJN2B06' }, { tag: 'JI448', placa: 'QVV5H92' }, { tag: 'RRD-1', placa: 'RRD0B94' }],
  administradores: [{ id: '00000000-0000-4000-8000-000000000001', nome: 'Analista SSMA', matricula: '90000' }],
});
globalThis.prisma = banco;
const { default: app } = await import('../src/app.js');

const { assinarSessao } = await import('../src/middleware/sessao.js');
const AUTH = { Authorization: `Bearer ${assinarSessao({ id: '00000000-0000-4000-8000-000000000001', matricula: '90000', nome: 'Admin', tipo: 'ADMINISTRADOR', setor: 'GESTAO', nivel: 'MASTER' })}` };
const JSON_AUTH = { ...AUTH, 'Content-Type': 'application/json' };
let base;
let servidor;
before(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api/telemetria`;
});
after(() => new Promise((r) => servidor.close(r)));

const CAB = ['DATA/HORA', 'TAG/PLACA', 'MOTORISTA', 'EVENTO', 'VALOR REGISTRADO', 'VELOCIDADE LIMITE', 'LOCALIZAÇÃO', 'SEVERIDADE'];
const linha = (data, placa, motorista, evento, vel) => [data, placa, motorista, evento, vel, 80, 'PA-275 Km 10', ''];

async function api(caminho, opcoes = {}) {
  const r = await fetch(`${base}${caminho}`, { headers: opcoes.body ? JSON_AUTH : AUTH, ...opcoes });
  return { status: r.status, corpo: await r.json() };
}

test('regras: só fadiga detectada é fadiga; farol por velocidade e janela de 15 min', () => {
  assert.equal(classificarTexto('Sensor de fadiga: Fadiga detectada').evento, 'Fadiga / Sono');
  assert.equal(classificarTexto('Sensor de fadiga: Bocejo'), null, 'outros textos de fadiga não são fadiga real');
  const d = (id, min, valor, placa = 'P1') => ({ id, tag_placa: placa, motorista: 'A', valor, data_hora: new Date(Date.UTC(2026, 10, 3, 12, min)) });
  const oc = agruparOcorrenciasFadiga([d('1', 0, 60), d('2', 10, 55), d('3', 40, 50), d('4', 41, 0), d('5', 42, 9)]);
  assert.deepEqual(oc.map((o) => [o.classificacao, o.deteccoes.length]), [
    ['CONFIRMADA', 2], // 2 detecções em movimento a 10 min uma da outra
    ['EM_ANALISE', 1], // isolada em movimento (30 min depois)
    ['VEICULO_PARADO', 1], // 0 km/h
    ['VEICULO_PARADO', 1], // 9 km/h: abaixo do gatilho de 10 km/h
  ]);
  assert.match(medidaFadiga('FADIGA_VERDADEIRA', 1, true), /reteste através da ferramenta Prontidão/);
  assert.match(medidaFadiga('FADIGA_VERDADEIRA', 2, false), /^Conversa formal com o líder \+ encaminhamento à medicina/);
  assert.equal(medidaFadiga('SEM_PARADA', 2), 'Suspensão de RAC');
  assert.match(medidaFadiga('PRONTIDAO', 3), /Comitê Pela Vida/);
});

test('fluxo da fadiga: farol, recorrência, validação, histórico e plano de ação', async () => {
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([CAB,
    linha('03/11/2026 08:00', 'GJN2B06', 'EUDE ARAUJO', 'Sensor de fadiga: Fadiga detectada', 60),
    linha('03/11/2026 08:09', 'GJN2B06', 'EUDE ARAUJO', 'Sensor de fadiga: Fadiga detectada', 58),
    linha('05/11/2026 18:20', 'GJN2B06', 'EUDE ARAUJO', 'Sensor de fadiga: Fadiga detectada', 62),
    linha('05/11/2026 18:30', 'GJN2B06', 'EUDE ARAUJO', 'Sensor de fadiga: Fadiga detectada', 61),
    linha('06/11/2026 09:41', 'GJN2B06', 'EUDE ARAUJO', 'Sensor de fadiga: Fadiga detectada', 0),
    linha('07/11/2026 14:00', 'QVV5H92', 'RAIMUNDO LIMA', 'Sensor de fadiga: Fadiga detectada', 45),
    linha('07/11/2026 15:00', 'QVV5H92', 'RAIMUNDO LIMA', 'Excesso de Velocidade', 100),
  ]), 'Modelo');
  const formulario = new FormData();
  formulario.append('arquivo', new Blob([XLSX.write(livro, { type: 'buffer', bookType: 'xlsx' })]), 'fadiga.xlsx');
  formulario.append('confirmar', 'true');
  const importacao = await fetch(`${base}/importar`, { method: 'POST', headers: AUTH, body: formulario }).then((r) => r.json());
  assert.equal(importacao.importados, 7);
  assert.equal(importacao.fadiga.veiculo_parado, 1);

  // Farol e recorrência
  let { corpo } = await api('/fadiga');
  assert.deepEqual(corpo.kpis.por_classificacao, { VEICULO_PARADO: 1, EM_ANALISE: 1, CONFIRMADA: 2, DESCARTADA: 0 });
  assert.equal(corpo.kpis.deteccoes, 6);
  const [segunda, primeira] = corpo.ocorrencias.filter((o) => o.classificacao === 'CONFIRMADA');
  assert.equal(primeira.ocorrencia_no_mes, 1);
  assert.equal(segunda.ocorrencia_no_mes, 2);
  assert.equal(segunda.deteccoes.length, 2);
  assert.equal(segunda.tag, 'CA-0388');
  assert.match(segunda.medidas.elegivel, /encaminhamento à medicina/);
  assert.equal(corpo.ranking_condutores[0].motorista, 'EUDE ARAUJO');
  assert.equal(corpo.kpis.confirmadas_sem_plano, 2);
  const isolada = corpo.ocorrencias.find((o) => o.classificacao === 'EM_ANALISE');
  assert.equal((await api('/fadiga?classificacao=VEICULO_PARADO')).corpo.ocorrencias.length, 1);

  // Validação da Central
  assert.equal((await api('/fadiga/validacao', { method: 'PATCH', body: JSON.stringify({ ids: isolada.ids, decisao: 'DESCARTADA' }) })).status, 400);
  const validada = await api('/fadiga/validacao', { method: 'PATCH', body: JSON.stringify({ ids: isolada.ids, decisao: 'CONFIRMADA' }) });
  assert.equal(validada.corpo.atualizados, 1);
  ({ corpo } = await api('/fadiga'));
  const raimundo = corpo.ocorrencias.find((o) => o.motorista === 'RAIMUNDO LIMA');
  assert.equal(raimundo.classificacao, 'CONFIRMADA');
  assert.equal(raimundo.validada_manualmente, true);
  assert.equal(raimundo.classificacao_automatica, 'EM_ANALISE');

  // Histórico do condutor
  const historico = (await api(`/motoristas/historico?motorista=${encodeURIComponent('RAIMUNDO LIMA')}`)).corpo;
  assert.equal(historico.total_eventos, 2);
  assert.deepEqual(
    { confirmada: historico.resumo_mensal[0].fadiga_confirmada, velocidade: historico.resumo_mensal[0].velocidade, abaixo: historico.resumo_mensal[0].velocidade_abaixo_gatilho },
    { confirmada: 1, velocidade: 0, abaixo: 1 },
  );

  // Plano de ação sobre a 2ª ocorrência do Eude (não elegível ao Prontidão)
  const misto = await api('/planos', { method: 'POST', body: JSON.stringify({ motorista: 'EUDE ARAUJO', linha_matriz: 'FADIGA_VERDADEIRA', eventos_ids: [...segunda.ids, ...raimundo.ids] }) });
  assert.equal(misto.status, 400, 'eventos de outro condutor não entram no plano');
  const criado = await api('/planos', {
    method: 'POST',
    body: JSON.stringify({
      motorista: 'EUDE ARAUJO', tag_placa: 'GJN2B06', linha_matriz: 'FADIGA_VERDADEIRA', nivel_recorrencia: 2, elegivel_prontidao: false,
      analise: 'Duas fadigas confirmadas no mês, ambas no fim do turno.', eventos_ids: segunda.ids,
      acoes: [{ descricao: 'Encaminhar à medicina', responsavel: 'Líder', prazo: '2026-11-20' }, { descricao: '' }],
    }),
  });
  assert.equal(criado.status, 201);
  assert.equal(criado.corpo.medida_matriz, medidaFadiga('FADIGA_VERDADEIRA', 2, false));
  assert.equal(criado.corpo.acoes.length, 1, 'ação sem descrição é ignorada');
  assert.ok(criado.corpo.prazo, 'prazo padrão de 15 dias');

  ({ corpo } = await api('/fadiga'));
  assert.equal(corpo.ocorrencias.find((o) => o.chave === segunda.chave).plano_acao.status, 'ABERTO');
  assert.equal(corpo.kpis.confirmadas_sem_plano, 2);
  assert.equal((await api('/planos')).corpo.planos[0].total_eventos, 2);

  // Conclusão exige evidência e fecha a tratativa dos eventos
  const id = criado.corpo.id;
  assert.equal((await api(`/planos/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CONCLUIDO' }) })).status, 400);
  const concluido = await api(`/planos/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CONCLUIDO', conclusao: 'Avaliação médica realizada em 18/11.' }) });
  assert.equal(concluido.corpo.status, 'CONCLUIDO');
  assert.ok(segunda.ids.every((eid) => banco.eventos.find((e) => e.id === eid).status_tratativa === 'TRATADO'));

  // Excluir o plano desvincula os eventos
  assert.equal((await api(`/planos/${id}`, { method: 'DELETE' })).status, 200);
  assert.ok(banco.eventos.every((e) => !e.plano_acao_id));
});

test('reimportar corrige o que foi gravado com a regra antiga (sem parada indevido e parada vazia)', async () => {
  const cab = ['Nome da Origem', 'Data Equipamento', 'Data GPS', 'Placa', 'Cerca', 'Duração Vel. Excedida - s', 'Velocidade', 'Limite Km/h', 'Motorista', 'Endereço', 'Google Maps Link', 'Evento'];
  const l = (data, vel, ev = 'Sensor de fadiga: Fadiga detectada') => ['x.xlsx', data, data, 'RRD0B94', '', '', vel, 80, 'CONDUTOR TESTE', 'pa-160', 'https://www.google.com/maps/?t=k&q=-6.05,-50.12', ev];
  const planilha = () => {
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([cab,
      l('12/11/2026 10:00', 0), l('12/11/2026 10:20', 30, 'Posição'), // parada: fadiga com o veículo parado
      l('12/11/2026 15:00', 60), l('12/11/2026 15:16', 62, 'Posição'), l('12/11/2026 15:20', 58, 'Posição'), // seguiu rodando
    ]), 'Telemetria');
    return XLSX.write(livro, { type: 'buffer', bookType: 'xlsx' });
  };
  const enviar = async () => {
    const f = new FormData();
    f.append('arquivo', new Blob([planilha()]), 'plataforma.xlsx');
    f.append('confirmar', 'true');
    return fetch(`${base}/importar`, { method: 'POST', headers: AUTH, body: f }).then((r) => r.json());
  };

  const primeira = await enviar();
  assert.equal(primeira.importados, 3, '2 fadigas + 1 sem parada (só a em movimento)');

  // Simula o estado gravado pela regra antiga: parada vazia e um "sem parada" para a fadiga parada.
  const doTeste = (e) => e.tag_placa === 'RRD0B94';
  banco.eventos.filter((e) => doTeste(e) && e.evento === 'Fadiga / Sono').forEach((e) => { e.parou_em_15_min = null; });
  const fadigaParada = banco.eventos.find((e) => doTeste(e) && e.valor === 0);
  banco.eventos.push({
    ...fadigaParada, id: '11111111-1111-4111-8111-111111111111', evento: 'Fadiga sem Parada Obrigatória', origem: 'DERIVADO',
    valor: null, data_hora: new Date(fadigaParada.data_hora.getTime() + 15 * 60000), chave_unica: 'regra-antiga',
  });

  const segunda = await enviar();
  assert.equal(segunda.importados, 0);
  assert.deepEqual(segunda.corrigidos, { parada_atualizada: 1, sem_parada_removidos: 1 });
  const eventos = banco.eventos.filter(doTeste);
  assert.equal(eventos.filter((e) => e.evento === 'Fadiga sem Parada Obrigatória').length, 1);
  assert.equal(eventos.find((e) => e.valor === 60).parou_em_15_min, false);
  assert.equal(eventos.find((e) => e.valor === 0).parou_em_15_min ?? null, null);
});
