// ============================================================================
// scripts/importarHistoricoLocal.js — Importacao do historico de Partes Diarias
//                                      para alimentar o BI de Eficiencia.
//
// Origem: 13/Parte Diaria Revisado.xlsx
// Destino: tabela `partes_diarias` (Neon/PostgreSQL via Prisma)
//
// Classificacao do STATUS (trim + sem acentos + caixa baixa + por conteudo):
//   "operacao" | "parte diaria feita" | "concluido"  -> "Operacao"             (valor 1)
//   "corretiva" | "manutencao corretiva"             -> "Manutencao Corretiva" (valor 0)
//   "indisponibilidade"                              -> "Indisponibilidade"    (valor 0)
//   "interdicao"                                     -> "Interdicao"           (valor 0)
//   "preventiva" | "manutencao preventiva"           -> "Manutencao Preventiva"(isenta)
//   Qualquer status contendo "pendente"              -> DESCARTADO
//
//   Os desvios sao checados antes de "parte diaria feita", pois o sufixo
//   "...(Manutencao Corretiva)" define a categoria.
//
// Os valores GRAVADOS sao os canonicos do dominio do app ("Operação",
// "Manutenção Corretiva", ...), os mesmos exigidos por parteDiariaController
// (validacao), manutencaoService (ancora de preventiva) e formulario/UI.
// A leitura do BI (/api/eficiencia) e tolerante a caixa e acentos.
//
// Chave logica: (TAG, DATA) — evita duplicatas. Se a planilha repetir a mesma
// chave com status diferentes, vence o de MAIOR severidade
// (desvio > preventiva > operacao), para nao mascarar corretivas/interdicoes.
// Se a TAG nao existir em mob_desmob -> cria registro fantasma para FK.
//
// Uso:
//   node scripts/importarHistoricoLocal.js [--limpar] [--dry-run] [--limit=N]
//
//   --limpar    Remove os registros de historico criados por importacoes
//               anteriores (criado_por = 'importacao-historico'|'-api') antes
//               de reimportar. NAO toca em registros criados pelo app.
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
const LIMPAR = args.includes('--limpar');
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

// =============================================================================
// Constantes de dominio (espelham exatamente o eficienciaController.js)
// =============================================================================
const STATUS_OPERACAO          = 'Opera\u00e7\u00e3o';
const STATUS_CORRETIVA         = 'Manuten\u00e7\u00e3o Corretiva';
const STATUS_PREVENTIVA        = 'Manuten\u00e7\u00e3o Preventiva';
const STATUS_INDISPONIBILIDADE = 'Indisponibilidade';
const STATUS_INTERDICAO        = 'Interdi\u00e7\u00e3o';

// Registros elegiveis para a limpeza (--limpar).
const CRIADORES_HISTORICO = ['importacao-historico', 'importacao-historico-api'];

// Severidade quando a planilha repete a mesma (TAG, DATA).
const PRIORIDADE_STATUS = {
  [STATUS_CORRETIVA]:         3,
  [STATUS_INDISPONIBILIDADE]: 3,
  [STATUS_INTERDICAO]:        3,
  [STATUS_PREVENTIVA]:        2,
  [STATUS_OPERACAO]:          1,
};

const TAMANHO_LOTE = 500;

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

// trim + sem acentos + caixa baixa (comparacao tolerante).
function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function norm(v) {
  return String(v || '').trim();
}

// STATUS da planilha -> status canonico do app.
//   null      = Pendente (descartar, nao gera registro no BI)
//   undefined = fora do dominio (ignorar)
function mapearStatus(rawStatus) {
  const s = normalizarTexto(rawStatus);
  if (!s) return undefined;
  if (s.includes('pendente')) return null;
  if (s.includes('corretiva')) return STATUS_CORRETIVA;
  if (s.includes('preventiva')) return STATUS_PREVENTIVA;
  if (s.includes('interdicao')) return STATUS_INTERDICAO;
  if (s.includes('indisponibilidade')) return STATUS_INDISPONIBILIDADE;
  if (s.includes('operacao') || s.includes('parte diaria feita') || s.includes('concluid')) return STATUS_OPERACAO;
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
  tagsCriadas.add(tag);
}

function imprimirResumo(resumo) {
  console.log('\n==================================================================');
  console.log('  RESUMO DA IMPORTACAO');
  console.log('==================================================================');
  console.log(`Linhas lidas (com TAG):            ${resumo.lidas}`);
  console.log(`Chaves unicas (TAG, DATA):         ${resumo.chaves}`);
  console.log(`Conflitos de status mesclados:     ${resumo.conflitos_resolvidos}`);
  console.log('------------------------------------------------------------------');
  console.log(`Registros removidos (--limpar):    ${DRY_RUN ? 'N/A (dry-run)' : resumo.limpeza_removidos}`);
  console.log(`Registros criados (banco):         ${DRY_RUN ? 'N/A (dry-run)' : resumo.criados}`);
  console.log(`Registros atualizados (banco):     ${DRY_RUN ? 'N/A (dry-run)' : resumo.atualizados}`);
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
}

// =============================================================================
// Main
// =============================================================================
async function main() {
  console.log('==================================================================');
  console.log('  Importacao Historico Partes Diarias -> BI de Eficiencia');
  console.log('==================================================================');
  console.log(`Modo:    ${DRY_RUN ? '[DRY-RUN] somente leitura — nada sera gravado' : '[PRODUCAO] gravacao real no banco'}`);
  if (LIMPAR && !DRY_RUN) console.log('Limpeza: [ATIVA] remove registros de importacoes anteriores antes de reimportar');
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

  const cabecalho = linhas[0].map((c) => normalizarTexto(c).toUpperCase());
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
    chaves: 0,
    conflitos_resolvidos: 0,
    ignoradas_pendente: 0,
    ignoradas_sem_data: 0,
    ignoradas_status_desconhecido: 0,
    limpeza_removidos: 0,
    criados: 0,
    atualizados: 0,
    operacao: 0,
    corretiva: 0,
    indisponibilidade: 0,
    interdicao: 0,
    preventiva_isenta: 0,
    falhas: [],
  };

  // ---------------------------------------------------------------------------
  // Passo 1: leitura + classificacao normalizada + dedupe (TAG, DATA).
  // ---------------------------------------------------------------------------
  const candidatos = new Map(); // `${tag}|${iso}` -> { tag, dataUTC, statusOperacional }
  let impressos = 0;

  for (let i = 0; i < total; i++) {
    resumo.lidas++;
    const linha = dados[i];
    const numLinha = i + 2;

    const tagRaw  = norm(linha[IDX_TAG]);
    const statusRaw = norm(linha[IDX_STATUS]);
    const dataDate = excelSerialParaDate(linha[IDX_DATA]);

    if (!dataDate) {
      resumo.ignoradas_sem_data++;
      if (DRY_RUN && impressos < 50) console.log(`  [IGNORADO] Linha ${numLinha}: TAG="${tagRaw}" — data invalida.`);
      continue;
    }

    const statusOperacional = mapearStatus(statusRaw);

    if (statusOperacional === null) {
      resumo.ignoradas_pendente++;
      if (DRY_RUN && impressos < 50) console.log(`  [DESCARTADO] Linha ${numLinha}: TAG="${tagRaw}" DATA=${paraISO(dataDate)} — Pendente.`);
      continue;
    }

    if (statusOperacional === undefined) {
      resumo.ignoradas_status_desconhecido++;
      console.log(`  [AVISO] Linha ${numLinha}: TAG="${tagRaw}" — status desconhecido: "${statusRaw}". Ignorado.`);
      continue;
    }

    const iso = paraISO(dataDate);
    const chave = `${tagRaw}|${iso}`;
    const anterior = candidatos.get(chave);

    if (!anterior) {
      candidatos.set(chave, { tag: tagRaw, dataUTC: new Date(`${iso}T00:00:00.000Z`), statusOperacional });
    } else {
      if (anterior.statusOperacional !== statusOperacional) {
        resumo.conflitos_resolvidos++;
        console.log(`  [CONFLITO] ${tagRaw} ${iso}: "${anterior.statusOperacional}" + "${statusOperacional}" -> vence o mais severo.`);
      }
      const prioNovo = PRIORIDADE_STATUS[statusOperacional] || 0;
      const prioAnterior = PRIORIDADE_STATUS[anterior.statusOperacional] || 0;
      if (prioNovo >= prioAnterior) {
        candidatos.set(chave, { tag: tagRaw, dataUTC: new Date(`${iso}T00:00:00.000Z`), statusOperacional });
      }
    }

    if (DRY_RUN && impressos < 50) {
      console.log(`  [DRY] ${String(numLinha).padStart(5)} TAG=${tagRaw.padEnd(12)} DATA=${iso} STATUS="${statusOperacional}" -> ${categoriaDeStatus(statusOperacional)}`);
      impressos++;
    }
  }

  resumo.chaves = candidatos.size;
  for (const c of candidatos.values()) {
    const cat = categoriaDeStatus(c.statusOperacional);
    resumo[cat] = (resumo[cat] || 0) + 1;
  }

  if (DRY_RUN) {
    imprimirResumo(resumo);
    console.log('\n[DRY-RUN] Nenhuma alteracao foi feita no banco.');
    console.log('Execute sem --dry-run para importar de verdade.\n');
    await prisma.$disconnect();
    return;
  }

  // ---------------------------------------------------------------------------
  // Passo 2 (opcional): limpeza dos registros criados por importacoes.
  // ---------------------------------------------------------------------------
  if (LIMPAR) {
    const removidos = await prisma.parteDiaria.deleteMany({
      where: { criado_por: { in: CRIADORES_HISTORICO } },
    });
    resumo.limpeza_removidos = removidos.count;
    console.log(`\n[LIMPEZA] ${removidos.count} registro(s) de historico removidos (criado_por in ${CRIADORES_HISTORICO.join(', ')}).\n`);
  }

  // ---------------------------------------------------------------------------
  // Passo 3: garante as TAGs de destino (fantasma quando ausente em mob_desmob).
  // ---------------------------------------------------------------------------
  const tagsNecessarias = [...new Set([...candidatos.values()].map((c) => c.tag))];
  const tagsExistentes = await prisma.mobDesmob.findMany({
    where: { tag: { in: tagsNecessarias } },
    select: { tag: true },
  });
  const setTags = new Set(tagsExistentes.map((t) => t.tag));
  const tagsCriadas = new Set();
  for (const tag of tagsNecessarias) {
    if (setTags.has(tag)) continue;
    await garantirTag(tag, tagsCriadas);
  }
  console.log(`TAGs no historico: ${tagsNecessarias.length} | fantasmas criadas agora: ${tagsCriadas.size}`);

  // ---------------------------------------------------------------------------
  // Passo 4: cria o que falta em lote e atualiza o que ja existe.
  // ---------------------------------------------------------------------------
  const existentes = await prisma.parteDiaria.findMany({
    where: { tag: { in: tagsNecessarias } },
    select: { id: true, tag: true, data: true },
  });
  const idPorChave = new Map(existentes.map((p) => [`${p.tag}|${paraISO(p.data)}`, p.id]));

  const criar = [];
  const atualizar = [];
  for (const [chave, c] of candidatos) {
    const id = idPorChave.get(chave);
    if (id) atualizar.push({ id, ...c });
    else criar.push(c);
  }

  console.log(`Registros a criar: ${criar.length} | a atualizar: ${atualizar.length}\n`);

  for (let i = 0; i < criar.length; i += TAMANHO_LOTE) {
    const lote = criar.slice(i, i + TAMANHO_LOTE).map((c) => ({
      tag:                c.tag,
      data:               c.dataUTC,
      status:             'APROVADO',
      status_operacional: c.statusOperacional,
      status_relatorio:   'APROVADO',
      status_aprovacao:   'Aprovado',
      status_assinatura:  'APROVADO',
      possui_pendencia:   false,
      criado_por:         'importacao-historico',
      atualizado_por:     'importacao-historico',
    }));
    try {
      const resultado = await prisma.parteDiaria.createMany({ data: lote, skipDuplicates: true });
      resumo.criados += resultado.count;
    } catch (e) {
      console.error(`  [FALHA] Lote de criacao a partir do indice ${i}: ${e.message}`);
      for (const item of lote) resumo.falhas.push({ tag: item.tag, erro: e.message });
    }
    if ((i / TAMANHO_LOTE + 1) % 5 === 0 || i + TAMANHO_LOTE >= criar.length) {
      console.log(`  -> criados: ${resumo.criados}/${criar.length}`);
    }
  }

  for (const item of atualizar) {
    try {
      await prisma.parteDiaria.update({
        where: { id: item.id },
        data: {
          status_operacional: item.statusOperacional,
          status_relatorio:   'APROVADO',
          status_aprovacao:   'Aprovado',
          atualizado_por:     'importacao-historico',
        },
      });
      resumo.atualizados++;
    } catch (e) {
      resumo.falhas.push({ tag: item.tag, erro: e.message });
      console.error(`  [FALHA] TAG="${item.tag}": ${e.message}`);
    }
  }

  imprimirResumo(resumo);

  if (resumo.falhas.length > 0) {
    console.log('Detalhamento das falhas:');
    for (const f of resumo.falhas.slice(0, 20)) console.error(`  TAG="${f.tag}": ${f.erro}`);
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
