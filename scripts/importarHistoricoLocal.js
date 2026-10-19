// ============================================================================
// scripts/importarHistoricoLocal.js — Importacao do historico de Partes Diarias
//                                      para alimentar o BI de Eficiencia.
//
// Origem: 13/Parte Diaria Revisado.xlsx
// Destino: tabela `partes_diarias` (Neon/PostgreSQL via Prisma)
//
// Regras de mapeamento (STATUS da planilha -> status_operacional):
//   "Parte Diaria Feita" | "Operacao"            -> "Operacao"             (valor 1)
//   "Parte Diaria Feita (Manutencao Corretiva)"  -> "Manutencao Corretiva" (valor 0)
//   "Parte Diaria Feita (Indisponibilidade)"     -> "Indisponibilidade"    (valor 0)
//   "Parte Diaria Feita (Interdicao)"            -> "Interdicao"           (valor 0)
//   "Parte Diaria Feita (Manutencao Preventiva)" -> "Manutencao Preventiva"(isenta)
//   Qualquer "Pendente" ou variacao              -> DESCARTADO
//
// Chave de Upsert: (TAG, DATA) — evita duplicatas.
// Se a TAG nao existir em mob_desmob -> cria registro fantasma para FK.
//
// Uso:
//   node scripts/importarHistoricoLocal.js [--dry-run] [--limit=N]
//
//   --dry-run   Apenas le, mapeia e exibe (sem escrita no banco).
//   --limit=N   Processa apenas as N primeiras linhas (para testes).
// ============================================================================
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import prisma from '../src/config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const XLSX_PATH = path.join(RAIZ, '13', 'Parte Di\u00e1ria Revisado.xlsx');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

// =============================================================================
// Constantes de dominio (espelham exatamente o eficienciaController.js)
// =============================================================================
const STATUS_OPERACAO          = 'Opera\u00e7\u00e3o';
const STATUS_CORRETIVA         = 'Manuten\u00e7\u00e3o Corretiva';
const STATUS_PREVENTIVA        = 'Manuten\u00e7\u00e3o Preventiva';
const STATUS_INDISPONIBILIDADE = 'Indisponibilidade';
const STATUS_INTERDICAO        = 'Interdi\u00e7\u00e3o';

// =============================================================================
// Helpers
// =============================================================================

function excelSerialParaDate(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return new Date(Math.round((valor - 25569) * 86400 * 1000));
  }
  const d = new Date(String(valor));
  return isNaN(d.getTime()) ? null : d;
}

function paraISO(date) {
  return date.toISOString().slice(0, 10);
}

function norm(v) {
  return String(v || '').trim();
}

function mapearStatus(rawStatus) {
  const s = norm(rawStatus);

  // Descarte imediato: Pendente
  if (/pendente/i.test(s)) return null;

  // Operacao (valor 1)
  if (s === 'Parte Di\u00e1ria Feita' || s === 'Opera\u00e7\u00e3o') return STATUS_OPERACAO;

  // Desvios (valor 0)
  if (s === 'Parte Di\u00e1ria Feita (Manuten\u00e7\u00e3o Corretiva)')  return STATUS_CORRETIVA;
  if (s === 'Parte Di\u00e1ria Feita (Indisponibilidade)')       return STATUS_INDISPONIBILIDADE;
  if (s === 'Parte Di\u00e1ria Feita (Interdi\u00e7\u00e3o)')             return STATUS_INTERDICAO;

  // Preventiva (isenta do denominador)
  if (s === 'Parte Di\u00e1ria Feita (Manuten\u00e7\u00e3o Preventiva)') return STATUS_PREVENTIVA;

  // Status fora do dominio mapeado
  return undefined;
}

function categoriaDeStatus(statusOperacional) {
  switch (statusOperacional) {
    case STATUS_OPERACAO:          return 'operacao';
    case STATUS_CORRETIVA:         return 'corretiva';
    case STATUS_INDISPONIBILIDADE: return 'indisponibilidade';
    case STATUS_INTERDICAO:        return 'interdicao';
    case STATUS_PREVENTIVA:        return 'preventiva_isenta';
    default:                       return 'desconhecido';
  }
}

async function garantirTag(tag, tagsCriadas) {
  if (tagsCriadas.has(tag)) return;
  const existe = await prisma.mobDesmob.findUnique({ where: { tag } });
  if (!existe) {
    const placaFantasma = `HIST-${tag}`.slice(0, 20);
    try {
      await prisma.mobDesmob.upsert({
        where:  { tag },
        update: {},
        create: { tag, placa: placaFantasma, status: 'Mobilizado', data_mob: new Date('2026-01-01T00:00:00.000Z') },
      });
      console.log(`  [AVISO] TAG "${tag}" ausente em mob_desmob -> veiculo fantasma criado (placa: ${placaFantasma}).`);
    } catch (e) {
      if (e.code === 'P2002') {
        const placaAlt = `HIST-${tag}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`.slice(0, 20);
        await prisma.mobDesmob.upsert({
          where:  { tag },
          update: {},
          create: { tag, placa: placaAlt, status: 'Mobilizado', data_mob: new Date('2026-01-01T00:00:00.000Z') },
        });
        console.log(`  [AVISO] TAG "${tag}" -> placa alternativa "${placaAlt}" usada.`);
      } else {
        throw e;
      }
    }
  }
  tagsCriadas.add(tag);
}

// =============================================================================
// Main
// =============================================================================
async function main() {
  console.log('==================================================================');
  console.log('  Importacao Historico Partes Diarias -> BI de Eficiencia');
  console.log('==================================================================');
  console.log(`Modo:    ${DRY_RUN ? '[DRY-RUN] somente leitura — nada sera gravado' : '[PRODUCAO] gravacao real no banco'}`);
  console.log(`Arquivo: ${XLSX_PATH}\n`);

  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`[FATAL] Arquivo nao encontrado: ${XLSX_PATH}`);
    process.exit(1);
  }

  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const nomeAba = wb.SheetNames[0];
  console.log(`Aba lida: "${nomeAba}"`);

  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: null });
  if (linhas.length < 2) {
    console.error('[FATAL] Planilha vazia ou sem dados apos o cabecalho.');
    process.exit(1);
  }

  const cabecalho = linhas[0].map((c) => norm(c).toUpperCase());
  console.log(`Colunas detectadas: ${cabecalho.join(' | ')}\n`);

  function encontrarColuna(...nomes) {
    for (const nome of nomes) {
      const idx = cabecalho.findIndex((c) => c === nome.toUpperCase());
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const IDX_TAG    = encontrarColuna('TAG', 'MATRICULA/TAG', 'EQUIPAMENTO', 'VEICULO', 'VE\u00cdCULO');
  const IDX_DATA   = encontrarColuna('DATA', 'DATE', 'DT');
  const IDX_STATUS = encontrarColuna('STATUS', 'TIPO', 'SITUACAO', 'SITUA\u00c7\u00c3O', 'STATUS/TIPO');

  if (IDX_TAG === -1 || IDX_DATA === -1 || IDX_STATUS === -1) {
    console.error('[FATAL] Nao foi possivel encontrar as colunas obrigatorias (TAG, DATA, STATUS).');
    console.error(`  Colunas lidas: ${cabecalho.join(' | ')}`);
    process.exit(1);
  }
  console.log(`Mapeamento de colunas: TAG=${IDX_TAG} | DATA=${IDX_DATA} | STATUS=${IDX_STATUS}`);

  const dados = linhas.slice(1).filter((r) => r[IDX_TAG] != null && norm(r[IDX_TAG]) !== '');
  const total = Math.min(dados.length, LIMIT);
  console.log(`Linhas com TAG: ${dados.length} | A processar: ${total}\n`);

  const resumo = {
    lidas: 0,
    processadas: 0,
    ignoradas_pendente: 0,
    ignoradas_sem_data: 0,
    ignoradas_status_desconhecido: 0,
    upserts: 0,
    operacao: 0,
    corretiva: 0,
    indisponibilidade: 0,
    interdicao: 0,
    preventiva_isenta: 0,
    falhas: [],
  };

  const tagsCriadas = new Set();

  for (let i = 0; i < total; i++) {
    resumo.lidas++;
    const linha = dados[i];
    const numLinha = i + 2;

    try {
      const tagRaw    = norm(linha[IDX_TAG]);
      const dataRaw   = linha[IDX_DATA];
      const statusRaw = norm(linha[IDX_STATUS]);

      const dataDate = excelSerialParaDate(dataRaw);
      if (!dataDate) {
        resumo.ignoradas_sem_data++;
        if (DRY_RUN) console.log(`  [IGNORADO] Linha ${numLinha}: TAG="${tagRaw}" — data invalida (${dataRaw}).`);
        continue;
      }

      const statusOperacional = mapearStatus(statusRaw);

      if (statusOperacional === null) {
        resumo.ignoradas_pendente++;
        if (DRY_RUN) console.log(`  [DESCARTADO] Linha ${numLinha}: TAG="${tagRaw}" DATA=${paraISO(dataDate)} — Pendente.`);
        continue;
      }

      if (statusOperacional === undefined) {
        resumo.ignoradas_status_desconhecido++;
        console.log(`  [AVISO] Linha ${numLinha}: TAG="${tagRaw}" — status desconhecido: "${statusRaw}". Ignorado.`);
        continue;
      }

      if (DRY_RUN) {
        const cat = categoriaDeStatus(statusOperacional);
        console.log(`  [DRY] ${String(numLinha).padStart(5)} TAG=${tagRaw.padEnd(12)} DATA=${paraISO(dataDate)} STATUS="${statusOperacional}" -> ${cat}`);
        resumo.processadas++;
        resumo[cat] = (resumo[cat] || 0) + 1;
        continue;
      }

      await garantirTag(tagRaw, tagsCriadas);

      const dataUTC = new Date(`${paraISO(dataDate)}T00:00:00.000Z`);

      const existente = await prisma.parteDiaria.findFirst({
        where: { tag: tagRaw, data: dataUTC },
        select: { id: true },
      });

      if (existente) {
        await prisma.parteDiaria.update({
          where: { id: existente.id },
          data: {
            status_operacional: statusOperacional,
            status_relatorio:   'APROVADO',
            status_aprovacao:   'Aprovado',
            atualizado_por:     'importacao-historico',
          },
        });
      } else {
        await prisma.parteDiaria.create({
          data: {
            tag:                tagRaw,
            data:               dataUTC,
            status:             'APROVADO',
            status_operacional: statusOperacional,
            status_relatorio:   'APROVADO',
            status_aprovacao:   'Aprovado',
            status_assinatura:  'APROVADO',
            possui_pendencia:   false,
            criado_por:         'importacao-historico',
            atualizado_por:     'importacao-historico',
          },
        });
      }

      resumo.upserts++;
      resumo.processadas++;
      const cat = categoriaDeStatus(statusOperacional);
      resumo[cat] = (resumo[cat] || 0) + 1;

      if (resumo.processadas % 100 === 0) {
        console.log(`  -> ${resumo.processadas} registros gravados...`);
      }
    } catch (e) {
      const tagTxt = norm(linha[IDX_TAG]) || `linha ${numLinha}`;
      resumo.falhas.push({ linha: numLinha, tag: tagTxt, erro: e.message });
      console.error(`  [FALHA] Linha ${numLinha} TAG="${tagTxt}": ${e.message}`);
    }
  }

  console.log('\n==================================================================');
  console.log('  RESUMO DA IMPORTACAO');
  console.log('==================================================================');
  console.log(`Total de linhas lidas:             ${resumo.lidas}`);
  console.log(`Registros processados:             ${resumo.processadas}`);
  console.log(`Upserts realizados (banco):        ${DRY_RUN ? 'N/A (dry-run)' : resumo.upserts}`);
  console.log('------------------------------------------------------------------');
  console.log(`Ignorados: Pendente:               ${resumo.ignoradas_pendente}`);
  console.log(`Ignorados: Data invalida:           ${resumo.ignoradas_sem_data}`);
  console.log(`Ignorados: Status desconhecido:     ${resumo.ignoradas_status_desconhecido}`);
  console.log('------------------------------------------------------------------');
  console.log(`Categoria: OPERACAO:               ${resumo.operacao}`);
  console.log(`Categoria: CORRETIVA:              ${resumo.corretiva}`);
  console.log(`Categoria: INDISPONIBILIDADE:      ${resumo.indisponibilidade}`);
  console.log(`Categoria: INTERDICAO:             ${resumo.interdicao}`);
  console.log(`Categoria: PREVENTIVA (isenta):    ${resumo.preventiva_isenta}`);
  console.log('------------------------------------------------------------------');
  console.log(`Falhas:                            ${resumo.falhas.length}`);
  console.log('==================================================================');

  if (resumo.falhas.length > 0) {
    console.log('\nDetalhamento das falhas:');
    for (const f of resumo.falhas) {
      console.error(`  Linha ${f.linha} TAG="${f.tag}": ${f.erro}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Nenhuma alteracao foi feita no banco.');
    console.log('Execute sem --dry-run para importar de verdade.\n');
  } else {
    console.log('\n[OK] Importacao concluida. O BI de Eficiencia agora reflete o historico.\n');
  }

  await prisma.$disconnect();
  if (resumo.falhas.length > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error('[FATAL]', e);
  try { await prisma.$disconnect(); } catch { /* noop */ }
  process.exit(1);
});
