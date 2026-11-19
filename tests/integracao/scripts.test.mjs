// Os scripts de linha de comando (contrato:novo / contrato:verificar) rodando de verdade,
// em outro processo, contra o PostgreSQL de teste.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { iniciarBanco } from './ambiente.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const executar = promisify(execFile);
let banco;
let env;
let pasta;

before(async () => {
  banco = await iniciarBanco();
  env = { ...process.env, DATABASE_URL: banco.url, NODE_ENV: 'test' };
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-kit-'));
}, { timeout: 120000 });

after(async () => {
  await banco?.encerrar();
  fs.rmSync(pasta, { recursive: true, force: true });
});

async function rodar(script, ...args) {
  try {
    const { stdout, stderr } = await executar('node', [path.join(RAIZ, 'scripts', script), ...args], { cwd: RAIZ, env, timeout: 90000 });
    return { codigo: 0, saida: stdout + stderr };
  } catch (erro) {
    return { codigo: erro.code, saida: `${erro.stdout ?? ''}${erro.stderr ?? ''}` };
  }
}
const contar = async (sql) => (await banco.db.query(sql)).rows[0].n;

test('o modelo do repositorio e um pedido valido; simulacao nao grava; --aplicar grava e mostra a senha uma vez', async () => {
  const modelo = path.join(RAIZ, 'scripts', 'modelo-novo-contrato.json');
  const simulacao = await rodar('novoContrato.mjs', '--arquivo', modelo);
  assert.equal(simulacao.codigo, 0, simulacao.saida);
  assert.match(simulacao.saida, /SIMULAÇÃO: nada foi gravado/);
  assert.equal(await contar('SELECT count(*)::int n FROM usuarios'), 0);

  const aplicado = await rodar('novoContrato.mjs', '--arquivo', modelo, '--aplicar');
  assert.equal(aplicado.codigo, 0, aplicado.saida);
  assert.match(aplicado.saida, /Contrato 010 criado: 5 usuário\(s\) e 1 obra/);
  assert.match(aplicado.saida, /Senhas provisórias/);
  assert.match(aplicado.saida, /matrícula 20001 — senha \S{10}/);
  assert.equal(await contar(`SELECT count(*)::int n FROM usuarios WHERE contrato = '010'`), 5);
  assert.equal(await contar(`SELECT count(*)::int n FROM usuarios WHERE senha_hash LIKE 'scrypt:%'`), 4, 'os 4 administradores tem senha com hash');
  assert.equal(await contar(`SELECT count(*)::int n FROM obras WHERE contrato = '010' AND planejador_matricula = '20002'`), 1);
});

test('rodar de novo, arquivo ausente e pedido invalido terminam com erro claro', async () => {
  const modelo = path.join(RAIZ, 'scripts', 'modelo-novo-contrato.json');
  const repetido = await rodar('novoContrato.mjs', '--arquivo', modelo, '--aplicar');
  assert.equal(repetido.codigo, 1);
  assert.match(repetido.saida, /já existe/);
  assert.equal(await contar('SELECT count(*)::int n FROM usuarios'), 5, 'nada duplicou');

  assert.equal((await rodar('novoContrato.mjs')).codigo, 2);
  assert.equal((await rodar('novoContrato.mjs', '--arquivo', path.join(pasta, 'nao-existe.json'))).codigo, 2);
  const ruim = path.join(pasta, 'ruim.json');
  fs.writeFileSync(ruim, JSON.stringify({ contrato: 'ABC', administradores: [] }));
  const invalido = await rodar('novoContrato.mjs', '--arquivo', ruim, '--aplicar');
  assert.equal(invalido.codigo, 1);
  assert.match(invalido.saida, /Contrato inválido/);
});

test('contrato:verificar lista o contrato novo, passa quando esta tudo certo e falha (codigo 1) com erro de integridade', async () => {
  const ok = await rodar('verificarContrato.mjs');
  assert.equal(ok.codigo, 0, ok.saida);
  assert.match(ok.saida, /Contrato 010: .*Usuários 5/);
  assert.match(ok.saida, /Nenhum erro de integridade/);

  // Planta um erro: administrador que nao consegue entrar.
  await banco.db.exec(`UPDATE usuarios SET senha_hash = NULL WHERE matricula = '20003'`);
  const falha = await rodar('verificarContrato.mjs');
  assert.equal(falha.codigo, 1);
  assert.match(falha.saida, /✖ Administrador sem senha cadastrada.*— 1/);
  assert.match(falha.saida, /20003 \| Ciclano Souza \| 010/);
});
