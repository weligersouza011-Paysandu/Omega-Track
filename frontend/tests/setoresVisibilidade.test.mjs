// Visibilidade de modulos por setor (menu e rotas do frontend).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { podeVerModulo, ehMeioAmbiente, ehTransporteSomente, podeEscrever } from '../src/utils/permissoes.js';

const adm = (setor, nivel = 'NORMAL') => ({ tipo: 'ADMINISTRADOR', setor, nivel });
const TRANSPORTE_MODULOS = ['inicio', 'obras', 'programacao-recursos', 'preditiva', 'gestao-eficiencia', 'telemetria'];
const AMBIENTAIS = ['controle-ambiental', 'controle-combustivel', 'ecogestao'];

test('Meio Ambiente enxerga so os modulos ambientais e a mobilizacao da frota', () => {
  const u = adm('MEIO_AMBIENTE');
  assert.ok(ehMeioAmbiente(u));
  for (const m of [...AMBIENTAIS, 'frota', 'usuarios', 'perfil']) assert.equal(podeVerModulo(u, m), true, m);
  for (const m of TRANSPORTE_MODULOS) assert.equal(podeVerModulo(u, m), false, m);
});

test('Transporte, Gestao, Planejador e Master enxergam todos os modulos', () => {
  for (const u of [adm('TRANSPORTE'), adm('GESTAO'), adm('PLANEJADOR'), adm('MEIO_AMBIENTE', 'MASTER')]) {
    for (const m of [...TRANSPORTE_MODULOS, ...AMBIENTAIS, 'frota']) assert.equal(podeVerModulo(u, m), true, `${u.setor} ${m}`);
  }
  assert.equal(ehMeioAmbiente(adm('MEIO_AMBIENTE', 'MASTER')), false);
});

test('Transporte le os ambientais mas nao escreve; Planejador escreve como a Gestao', () => {
  assert.ok(ehTransporteSomente(adm('TRANSPORTE')));
  for (const m of AMBIENTAIS) assert.equal(podeEscrever(adm('TRANSPORTE'), m), false, m);
  for (const m of AMBIENTAIS) assert.equal(podeEscrever(adm('MEIO_AMBIENTE'), m), true, m);
  for (const setor of ['GESTAO', 'PLANEJADOR']) {
    for (const m of [...AMBIENTAIS, ...TRANSPORTE_MODULOS]) assert.equal(podeEscrever(adm(setor), m), true, `${setor} ${m}`);
  }
  assert.equal(podeEscrever(adm('MEIO_AMBIENTE'), 'telemetria'), false);
});
