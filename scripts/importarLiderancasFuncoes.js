import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(repo, '..', '..', 'anotações', 'FUNCOES.xlsx');
const resultPath = path.join(repo, '.local', 'liderancas-funcoes-import-result.json');
const expectedSha256 = '30AFCFF25213D4AE3C3AE3EBFEECECB107B7C66C77CE8E127E34A67F6317082B';
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

function normalizar(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function conferirDestino() {
  const url = new URL(process.env.DATABASE_URL);
  const db = decodeURIComponent(url.pathname.slice(1));
  if (!['127.0.0.1', 'localhost'].includes(url.hostname.toLowerCase()) || db !== 'omegatrack_dev') {
    throw new Error('Importação permitida somente no banco local 127.0.0.1/omegatrack_dev.');
  }
  return { url, db };
}

async function executar(bin, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: repo, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`Backup falhou (${code}): ${output.slice(-400)}`)));
  });
}

async function backup({ url, db }) {
  const bin = 'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe';
  if (!fs.existsSync(bin)) throw new Error('pg_dump do PostgreSQL 18 não encontrado. Importação cancelada.');
  const directory = path.join(repo, '.local', 'backups');
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(directory, `omegatrack_before_liderancas_${stamp}.dump`);
  const args = ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', db, '-F', 'c', '-f', target];
  await executar(bin, args, { ...process.env, PGPASSWORD: decodeURIComponent(url.password) });
  if (!fs.statSync(target).size) throw new Error('Backup vazio. Importação cancelada.');
  return target;
}

async function main() {
  const target = conferirDestino();
  const bytes = fs.readFileSync(source);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (sha256 !== expectedSha256) throw new Error('A planilha mudou desde a prévia. Confira a nova versão antes de importar.');
  const book = xlsx.read(bytes, { type: 'buffer', raw: false });
  if (book.SheetNames.length !== 1) throw new Error('Esperada uma única aba em FUNCOES.xlsx.');
  const rows = xlsx.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '', raw: false });
  if (rows[0].slice(0, 3).map(normalizar).join('|') !== 'matricula|nome|funcao') {
    throw new Error('Cabeçalho inesperado. Esperado: matricula, nome, função.');
  }

  const selected = [];
  const byMatricula = new Map();
  const categories = new Map();
  const groups = { supervisores: 0, coordenadores: 0, engenheiros: 0 };
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const matricula = String(row[0] ?? '').trim();
    const nome = String(row[1] ?? '').trim();
    const funcao = String(row[2] ?? '').trim();
    const functionKey = normalizar(funcao);
    const categoria = functionKey.match(/(^|[^a-z])(supervisor(?:es)?|coordenador(?:es)?|engenheiro(?:s)?)([^a-z]|$)/)?.[2];
    if (!categoria) continue;
    if (!matricula || !nome || !funcao || matricula.length > 50 || nome.length > 255 || funcao.length > 100) {
      throw new Error(`Linha ${i + 1}: dados de colaborador ausentes ou além do limite da tabela.`);
    }
    if (/^(ajudante|auxiliar|assistente)\b/.test(functionKey)) continue;
    const key = matricula.toUpperCase();
    const previous = byMatricula.get(key);
    if (previous && (normalizar(previous.nome) !== normalizar(nome) || normalizar(previous.funcao) !== functionKey)) {
      throw new Error(`Matrícula ${matricula} repetida com dados divergentes nas linhas ${previous.linha} e ${i + 1}.`);
    }
    if (!previous) {
      const item = { linha: i + 1, matricula, nome, funcao };
      selected.push(item);
      byMatricula.set(key, item);
      categories.set(funcao, (categories.get(funcao) || 0) + 1);
      if (categoria.startsWith('supervisor')) groups.supervisores += 1;
      else if (categoria.startsWith('coordenador')) groups.coordenadores += 1;
      else groups.engenheiros += 1;
    }
  }
  if (!selected.length) throw new Error('Nenhum supervisor, coordenador ou engenheiro encontrado.');
  if (selected.length > 500) throw new Error('Mais de 500 colaboradores: dividir em lotes antes de enviar para a API.');

  const existing = await prisma.usuario.findMany({
    where: { matricula: { in: selected.map((item) => item.matricula) } },
    select: { matricula: true, nome: true, funcao: true, tipo: true },
  });
  const existingByMatricula = new Map(existing.map((item) => [item.matricula.toUpperCase(), item]));
  const conflicts = [];
  const alreadyPresent = [];
  const inserts = [];
  for (const item of selected) {
    const found = existingByMatricula.get(item.matricula.toUpperCase());
    if (!found) inserts.push({ matricula: item.matricula, nome: item.nome, funcao: item.funcao });
    else if (found.tipo !== 'OPERACIONAL' || normalizar(found.nome) !== normalizar(item.nome) || normalizar(found.funcao) !== normalizar(item.funcao)) {
      conflicts.push({ matricula: item.matricula, tipo: found.tipo, nomeBanco: found.nome, funcaoBanco: found.funcao, nomePlanilha: item.nome, funcaoPlanilha: item.funcao });
    } else alreadyPresent.push(item.matricula);
  }
  console.log(JSON.stringify({
    source, sha256, database: target.db, scannedRows: rows.length - 1,
    selectedPeople: selected.length, groups, categories: Object.fromEntries(categories),
    toCreate: inserts.length, alreadyPresent: alreadyPresent.length, conflicts,
  }, null, 2));
  if (conflicts.length) throw new Error('Há matrículas conflitantes. Nenhum usuário foi criado.');
  if (!apply) {
    console.log('Prévia concluída. Use --apply para criar os logins operacionais.');
    return;
  }
  if (!inserts.length) {
    console.log('Todos os colaboradores selecionados já estão cadastrados; nenhuma alteração necessária.');
    return;
  }

  const backupPath = await backup(target);
  const admin = await prisma.usuario.findFirst({
    where: { tipo: 'ADMINISTRADOR', nivel: 'MASTER' },
    select: { id: true, matricula: true, nome: true, tipo: true, setor: true, nivel: true },
  });
  if (!admin) throw new Error('Administrador Master não encontrado. Importação cancelada.');
  const secret = process.env.LOGIN_JWT_SECRET || process.env.API_KEY;
  if (!secret) throw new Error('Segredo de sessão ausente. Importação cancelada.');
  const token = jwt.sign({ sub: admin.id, matricula: admin.matricula, nome: admin.nome, tipo: admin.tipo, setor: admin.setor, nivel: admin.nivel }, secret, { expiresIn: '5m' });
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const response = await fetch(`${base}/api/usuarios/lote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ usuarios: inserts }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 201 || body.data?.criados !== inserts.length || body.data?.ignorados?.length) {
    throw new Error(`Importação retornou HTTP ${response.status}, criados ${body.data?.criados ?? '?'}, ignorados ${body.data?.ignorados?.length ?? '?'}. Confira o banco antes de repetir.`);
  }

  const stored = await prisma.usuario.findMany({
    where: { matricula: { in: selected.map((item) => item.matricula) } },
    select: { matricula: true, nome: true, funcao: true, tipo: true },
  });
  if (stored.length !== selected.length || stored.some((user) => user.tipo !== 'OPERACIONAL')) {
    throw new Error('Verificação final falhou: quantidade ou perfil divergiu.');
  }
  const byStoredMatricula = new Map(stored.map((user) => [user.matricula.toUpperCase(), user]));
  for (const item of selected) {
    const user = byStoredMatricula.get(item.matricula.toUpperCase());
    if (!user || normalizar(user.nome) !== normalizar(item.nome) || normalizar(user.funcao) !== normalizar(item.funcao)) {
      throw new Error(`Verificação final falhou para matrícula ${item.matricula}.`);
    }
  }
  for (const item of [selected[0], selected.at(-1)]) {
    const login = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matricula: item.matricula }),
    });
    const data = await login.json().catch(() => ({}));
    if (login.status !== 200 || data.data?.usuario?.tipo !== 'OPERACIONAL' || !data.data?.token) {
      throw new Error(`Login de conferência falhou para a matrícula ${item.matricula}.`);
    }
  }
  const report = {
    importedAt: new Date().toISOString(), source, sha256, backupPath,
    selectedPeople: selected.length, created: inserts.length, alreadyPresent: alreadyPresent.length,
    groups, categories: Object.fromEntries(categories), users: selected,
  };
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Importação concluída: ${inserts.length} logins operacionais criados; ${selected.length} colaboradores verificados.`);
  console.log(`Backup: ${backupPath}`);
  console.log(`Relatório local: ${resultPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
