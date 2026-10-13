// ============================================================================
// scripts/importarPasta13.js — Carga da frota (pasta 13/) para Neon + Cloudinary
//
// Fluxo por linha da planilha:
//   1. Lê TAG, Placa, Status, Data MOB/DESMOB, Modelo, Contrato e ref. da foto.
//   2. Resolve o arquivo físico em 13/MOB  DESMOB_Images/.
//   3. Sobe a foto para o Cloudinary (omegatrack/mobilizacao) via SDK.
//   4. Faz upsert no Neon (tabela mob_desmob) guardando SOMENTE a secure_url.
//
// Uso:
//   node scripts/importarPasta13.js [--dry-run] [--skip-upload] [--limit=N]
//
//   --dry-run      Apenas lê e valida (nenhum upload, nenhuma escrita no Neon).
//   --skip-upload  Não sobe fotos; grava só os dados (foto_veiculo preservado).
//   --limit=N      Processa apenas as N primeiras linhas (para testes).
// ============================================================================
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import XLSX from 'xlsx';
import prisma from '../src/config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const PASTA13 = path.join(RAIZ, '13');
const XLSX_PATH = path.join(PASTA13, 'MOB  DESMOB.xlsx');
const IMAGENS_DIR = path.join(PASTA13, 'MOB  DESMOB_Images');
const PASTA_CLOUDINARY = 'omegatrack/mobilizacao';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_UPLOAD = args.includes('--skip-upload');
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

// --- Validação de ambiente ---------------------------------------------------
function exigirEnv(nome) {
  if (!process.env[nome] || String(process.env[nome]).trim() === '') {
    console.error(`[FATAL] Variável ${nome} ausente no .env.`);
    process.exit(1);
  }
}
exigirEnv('DATABASE_URL');
if (!DRY_RUN && !SKIP_UPLOAD) {
  exigirEnv('CLOUDINARY_CLOUD_NAME');
  exigirEnv('CLOUDINARY_API_KEY');
  exigirEnv('CLOUDINARY_API_SECRET');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// --- Helpers -----------------------------------------------------------------
// Serial do Excel (dias desde 1899-12-30) -> Date UTC (meia-noite).
function excelSerialParaDate(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return new Date(Math.round((valor - 25569) * 86400 * 1000));
  }
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizarStatus(raw) {
  const s = String(raw || '').trim();
  if (/^mobilizado/i.test(s)) return 'Mobilizado';
  if (/^desmobilizado/i.test(s)) return 'Desmobilizado';
  return s || 'Mobilizado';
}

function normalizarTagParaBusca(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Resolve o arquivo de foto: 1) basename da ref. da planilha; 2) fallback por TAG.
function resolverFoto(refPlanilha, tag, arquivosEmDisco) {
  if (refPlanilha && String(refPlanilha).trim() !== '') {
    const base = String(refPlanilha).trim().split('/').pop();
    if (arquivosEmDisco.has(base)) return { arquivo: base, origem: 'planilha' };
    return { arquivo: null, origem: `ref da planilha não encontrada em disco (${base})` };
  }
  const alvo = normalizarTagParaBusca(tag);
  const candidato = [...arquivosEmDisco].find((f) => {
    const prefixo = f.split('.Foto')[0] || f;
    return normalizarTagParaBusca(prefixo) === alvo;
  });
  if (candidato) return { arquivo: candidato, origem: 'fallback-por-tag' };
  return { arquivo: null, origem: 'sem foto na planilha e nenhum arquivo *TAG* em disco' };
}

function publicIdParaTag(tag) {
  return `veiculo-${normalizarTagParaBusca(tag).toLowerCase()}`;
}

async function uploadFoto(caminhoArquivo, tag) {
  const res = await cloudinary.uploader.upload(caminhoArquivo, {
    folder: PASTA_CLOUDINARY,
    public_id: publicIdParaTag(tag),
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
    tags: ['omegatrack', 'mobilizacao', 'importacao-pasta13'],
    transformation: [
      { width: 1600, height: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' },
    ],
  });
  return res.secure_url;
}

// --- Carga -------------------------------------------------------------------
async function main() {
  console.log('=== Importação Pasta 13 -> Neon + Cloudinary ===');
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (somente leitura)' : SKIP_UPLOAD ? 'SKIP-UPLOAD (só banco)' : 'FULL (fotos + banco)'}`);
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`[FATAL] Planilha não encontrada: ${XLSX_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(IMAGENS_DIR)) {
    console.error(`[FATAL] Pasta de imagens não encontrada: ${IMAGENS_DIR}`);
    process.exit(1);
  }

  const arquivosEmDisco = new Set(fs.readdirSync(IMAGENS_DIR));
  console.log(`Arquivos de imagem em disco: ${arquivosEmDisco.size}`);

  const wb = XLSX.readFile(XLSX_PATH);
  const nomeAba = wb.SheetNames[0];
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: null });
  const cabecalho = linhas[0];
  console.log(`Aba: "${nomeAba}" | Colunas: ${cabecalho.join(' | ')}`);

  const dados = linhas.slice(1).filter((r) => r[1] != null && String(r[1]).trim() !== '');
  const total = Math.min(dados.length, LIMIT);
  console.log(`Linhas válidas (com TAG): ${dados.length} | A processar: ${total}\n`);

  const resumo = { criados: 0, atualizados: 0, fotos: 0, semFoto: 0, falhas: [] };

  for (let i = 0; i < total; i += 1) {
    const [refFoto, tagRaw, placaRaw, statusRaw, mobRaw, desmobRaw, modeloRaw, contratoRaw] = dados[i];
    const prefixo = `[${i + 1}/${total}]`;
    try {
      const tag = String(tagRaw).trim();
      const placaBase = String(placaRaw || '').trim().toUpperCase();
      const placa = placaBase !== '' ? placaBase : `SEM-PLACA-${normalizarTagParaBusca(tag)}`;
      const status = normalizarStatus(statusRaw);
      const data_mob = excelSerialParaDate(mobRaw);
      const data_desmob = excelSerialParaDate(desmobRaw);
      const modelo = modeloRaw ? String(modeloRaw).trim() : null;
      const contrato = contratoRaw ? String(contratoRaw).trim() : null;

      // 1) Foto
      let fotoUrl = null;
      const { arquivo, origem } = resolverFoto(refFoto, tag, arquivosEmDisco);
      if (arquivo && !DRY_RUN && !SKIP_UPLOAD) {
        const caminho = path.join(IMAGENS_DIR, arquivo);
        fotoUrl = await uploadFoto(caminho, tag);
        resumo.fotos += 1;
      } else if (!arquivo) {
        resumo.semFoto += 1;
      }

      if (DRY_RUN) {
        console.log(
          `${prefixo} TAG ${tag} | placa=${placa} | status=${status} | ` +
            `mob=${data_mob ? data_mob.toISOString().slice(0, 10) : '-'} | ` +
            `desmob=${data_desmob ? data_desmob.toISOString().slice(0, 10) : '-'} | ` +
            `foto=${arquivo || '(ausente: ' + origem + ')'}`,
        );
        continue;
      }

      // 2) Upsert no Neon (somente a URL da nuvem; jamais binário).
      const dadosComuns = {
        placa,
        status,
        data_mob: data_mob || undefined,
        data_desmob: data_desmob || null,
        modelo,
        contrato,
      };
      let operacao = 'atualizado';
      try {
        const existente = await prisma.mobDesmob.findUnique({ where: { tag } });
        operacao = existente ? 'atualizado' : 'criado';
        await prisma.mobDesmob.upsert({
          where: { tag },
          update: { ...dadosComuns, ...(fotoUrl ? { foto_veiculo: fotoUrl } : {}) },
          create: { tag, ...dadosComuns, foto_veiculo: fotoUrl },
        });
      } catch (e) {
        // Placa duplicada na planilha (ex.: QVT0A38 em 2 TAGs) -> sufixa com a TAG.
        if (e.code === 'P2002') {
          const placaAlt = `${placa}-${normalizarTagParaBusca(tag)}`.slice(0, 20);
          const existente = await prisma.mobDesmob.findUnique({ where: { tag } });
          operacao = existente ? 'atualizado' : 'criado';
          await prisma.mobDesmob.upsert({
            where: { tag },
            update: { ...dadosComuns, placa: placaAlt, ...(fotoUrl ? { foto_veiculo: fotoUrl } : {}) },
            create: { tag, ...dadosComuns, placa: placaAlt, foto_veiculo: fotoUrl },
          });
          console.log(`${prefixo} TAG ${tag}: placa duplicada "${placa}" -> usando "${placaAlt}".`);
        } else {
          throw e;
        }
      }

      if (operacao === 'criado') resumo.criados += 1;
      else resumo.atualizados += 1;

      if (fotoUrl) {
        console.log(`${prefixo} Foto da TAG ${tag} enviada para o Cloudinary e veículo salvo no Neon com sucesso!`);
      } else if (SKIP_UPLOAD || DRY_RUN) {
        console.log(`${prefixo} TAG ${tag}: veículo ${operacao} no Neon (upload pulado).`);
      } else {
        console.log(`${prefixo} TAG ${tag}: veículo ${operacao} no Neon (sem foto — ${origem}).`);
      }
    } catch (e) {
      const tagTxt = dados[i][1] != null ? String(dados[i][1]).trim() : `linha ${i + 2}`;
      resumo.falhas.push({ tag: tagTxt, erro: e.message });
      console.error(`${prefixo} FALHA na TAG ${tagTxt}: ${e.message}`);
    }
  }

  console.log('\n=== Resumo ===');
  console.log(`Veículos criados:     ${resumo.criados}`);
  console.log(`Veículos atualizados: ${resumo.atualizados}`);
  console.log(`Fotos no Cloudinary:  ${resumo.fotos}`);
  console.log(`Sem foto:             ${resumo.semFoto}`);
  console.log(`Falhas:               ${resumo.falhas.length}`);
  for (const f of resumo.falhas) console.log(`  - ${f.tag}: ${f.erro}`);

  await prisma.$disconnect();
  if (resumo.falhas.length > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error('[FATAL]', e);
  try {
    await prisma.$disconnect();
  } catch {
    /* noop */
  }
  process.exit(1);
});
