import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { PrismaClient } from '@prisma/client';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(repo, '..', '..', 'anotações', 'VEICULOS.xlsx');
const reportPath = path.join(repo, '.local', 'veiculos-ct251-import-result.json');
const expectedSha256 = 'FCBABD473B3F7A8AF0EA96335B001F60DC5AE85A733E84DA70F0642569D9C29E';
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

const plateKey = (value) => String(value).trim().toLocaleUpperCase('pt-BR');
const comparablePlate = (value) => plateKey(value).replace(/[\s-]/g, '');

async function main() {
  const bytes = fs.readFileSync(source);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (sha256 !== expectedSha256) {
    throw new Error('A planilha mudou desde a conferência. Revise as linhas antes de importar.');
  }

  const workbook = xlsx.read(bytes, { type: 'buffer' });
  if (workbook.SheetNames.length !== 1) throw new Error('Esperada uma planilha com uma aba.');
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
  if (rows[0].map((v) => String(v).trim()).join('|') !== 'Tipo|Tag|Placa') {
    throw new Error('Cabeçalho inesperado. Esperado: Tipo, Tag, Placa.');
  }

  const input = rows.slice(1).map((row, index) => {
    const tipo = String(row[0] ?? '').trim();
    const tagOriginal = String(row[1] ?? '').trim();
    const placaOriginal = String(row[2] ?? '').trim();
    if (!tipo || !tagOriginal || !placaOriginal) {
      throw new Error(`Linha ${index + 2}: tipo, TAG e placa são obrigatórios.`);
    }
    const tag = tipo === 'BANHEIRO CARRETINHA' && tagOriginal === 'JI212'
      ? 'JI212-BANHEIRO'
      : tagOriginal;
    return { linha: index + 2, tipo, tagOriginal, tag, placaOriginal };
  });

  const plateTotals = new Map();
  for (const row of input) {
    const key = plateKey(row.placaOriginal);
    plateTotals.set(key, (plateTotals.get(key) || 0) + 1);
  }
  const plateSequence = new Map();
  const seenTags = new Set();
  const seenPlates = new Set();
  for (const row of input) {
    const key = plateKey(row.placaOriginal);
    const sequence = (plateSequence.get(key) || 0) + 1;
    plateSequence.set(key, sequence);
    const number = String(sequence).padStart(2, '0');
    row.placa = plateTotals.get(key) > 1
      ? (row.placaOriginal === '-' ? `- ${number}` : `${row.placaOriginal} - ${number}`)
      : row.placaOriginal;
    if (row.tag.length > 50 || row.placa.length > 20 || row.tipo.length > 100) {
      throw new Error(`Linha ${row.linha}: um campo excede o limite da tabela.`);
    }
    if (seenTags.has(row.tag.toUpperCase())) throw new Error(`TAG duplicada após ajuste: ${row.tag}`);
    if (seenPlates.has(plateKey(row.placa))) throw new Error(`Placa duplicada após ajuste: ${row.placa}`);
    seenTags.add(row.tag.toUpperCase());
    seenPlates.add(plateKey(row.placa));
  }

  const existing = await prisma.mobDesmob.findMany({
    select: { tag: true, placa: true, modelo: true, contrato: true, status: true },
  });
  const byTag = new Map(existing.map((item) => [item.tag.toUpperCase(), item]));
  const byPlate = new Map(existing.map((item) => [plateKey(item.placa), item]));
  const inserts = [];
  for (const row of input) {
    const found = byTag.get(row.tag.toUpperCase());
    if (found) {
      if (comparablePlate(found.placa) !== comparablePlate(row.placa) ||
          String(found.modelo || '').toUpperCase() !== row.tipo.toUpperCase() ||
          found.contrato !== 'CT-251') {
        throw new Error(`TAG ${row.tag} já existe com dados diferentes. Nenhum registro foi alterado.`);
      }
      row.acao = 'ja_existia';
      row.placaGravada = found.placa;
      continue;
    }
    const plateConflict = byPlate.get(plateKey(row.placa));
    if (plateConflict) {
      throw new Error(`Placa ${row.placa} já pertence à TAG ${plateConflict.tag}.`);
    }
    row.acao = 'inserir';
    row.placaGravada = row.placa;
    inserts.push({
      tag: row.tag,
      placa: row.placa,
      modelo: row.tipo,
      contrato: 'CT-251',
      status: 'Mobilizado',
      data_mob: null,
    });
  }

  for (const row of input) {
    console.log(`${row.linha} | ${row.tipo} | ${row.tagOriginal} -> ${row.tag} | ${row.placaOriginal} -> ${row.placaGravada} | ${row.acao}`);
  }
  console.log(`Planilha: ${input.length} linhas; existentes: ${input.length - inserts.length}; a inserir: ${inserts.length}.`);
  if (!apply) {
    console.log('Prévia concluída. Use --apply para gravar.');
    return;
  }

  if (inserts.length > 0) {
    const result = await prisma.$transaction((tx) => tx.mobDesmob.createMany({ data: inserts }));
    if (result.count !== inserts.length) throw new Error('A quantidade inserida divergiu da prévia.');
  }
  const stored = await prisma.mobDesmob.findMany({
    where: { tag: { in: input.map((row) => row.tag) } },
    select: { tag: true, placa: true, modelo: true, contrato: true },
  });
  if (stored.length !== input.length) throw new Error('Verificação final: faltam TAGs no banco.');
  for (const row of input) {
    const item = stored.find((value) => value.tag === row.tag);
    if (!item || item.placa !== row.placaGravada || item.modelo !== row.tipo || item.contrato !== 'CT-251') {
      throw new Error(`Verificação final falhou para ${row.tag}.`);
    }
  }
  const report = {
    importedAt: new Date().toISOString(), source, sha256,
    contract: 'CT-251', status: 'Mobilizado', mobilizationDate: null,
    totalRows: input.length, inserted: inserts.length, alreadyPresent: input.length - inserts.length,
    rows: input,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Importação concluída. Relatório: ${reportPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
