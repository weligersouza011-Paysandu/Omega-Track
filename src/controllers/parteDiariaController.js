import prisma from '../config/database.js';
import config from '../config/index.js';
import { asyncHandler } from '../middleware/error.js';
import { sessaoOperacional } from '../middleware/sessao.js';
import { parseKm, obterUltimaKmFinal } from '../services/manutencaoService.js';
import { uploadMiddleware, cloudinaryConfigured, validarUrlMidia } from '../config/cloudinary.js';

// ============================================================================
// Parte Diaria (Veiculos Leves) — modelo Omega Service
// Formulario completo: cabecalho/metadata, horarios, modulos dinamicos
// (mao de obra, equipamentos, atividades, ocorrencias, checklist,
// comentarios, fotos), assinaturas em 3 etapas e auditoria.
// ============================================================================

const ETAPAS_ASSINATURA = ['OPERADOR', 'TRANSPORTE', 'PLANEJADOR'];
const STATUS_RELATORIO_VALIDOS = ['PREENCHENDO', 'REVISAO', 'APROVADO'];

export const STATUS_OPERACIONAL_VALIDOS = [
  'Operação',
  'Manutenção Corretiva',
  'Manutenção Preventiva',
  'Indisponibilidade',
  'Interdição',
  'Não Operado',
];

export const STATUS_APROVACAO_VALIDOS = [
  'Em Preenchimento',
  'Finalizado pelo Operador',
  'Revisado pelo Transporte',
  'Aprovado',
];

export function calcularStatusAprovacao(assinaturas = []) {
  const etapas = new Set((assinaturas || []).map((a) => String(a.etapa || '').toUpperCase()));
  if (etapas.has('PLANEJADOR')) return 'Aprovado';
  if (etapas.has('TRANSPORTE')) return 'Revisado pelo Transporte';
  if (etapas.has('OPERADOR')) return 'Finalizado pelo Operador';
  return 'Em Preenchimento';
}

export function statusAprovacaoParaRelatorio(statusAprovacao) {
  if (statusAprovacao === 'Aprovado') return 'APROVADO';
  if (statusAprovacao === 'Finalizado pelo Operador' || statusAprovacao === 'Revisado pelo Transporte') return 'REVISAO';
  return 'PREENCHENDO';
}

// Compat frontend: expõe `assinatura_url` como alias de `assinatura_dado`
// (o formulário lê ambos via imagemAssinatura).
export function enriquecerAssinaturas(parte) {
  if (parte?.assinaturas) {
    parte.assinaturas = parte.assinaturas.map((a) => ({
      ...a,
      assinatura_url: a.assinatura_url || a.assinatura_dado || null,
    }));
  }
  return parte;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const DIAS_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function diaSemanaPT(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return DIAS_PT[d.getDay()] ?? null;
}

function gerarNumeroRelatorio() {
  const base = Date.now().toString(36).toUpperCase().slice(-6).padStart(6, '0');
  return `PD-${base}`;
}

function validarHorario(valor, nomeCampo) {
  if (valor === undefined || valor === null || valor === '') return;
  if (typeof valor !== 'string' || !HHMM.test(valor.trim())) {
    const err = new Error(`Campo \`${nomeCampo}\` invalido: use o formato HH:MM (ex: 07:30).`);
    err.statusCode = 400;
    throw err;
  }
}

function toIntOuNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Trava de integridade do odômetro.
// Preventiva (lançamento retroativo permitido): exige só KM Final numérica > 0,
// sem comparar com a KM Inicial nem com o histórico do veículo.
// Demais status: KM Final nunca abaixo da KM Inicial.
function validarQuilometragem(kmInicial, kmFinal, statusOperacional = null) {
  if (String(statusOperacional || '') === 'Manutenção Preventiva') {
    const fim = parseKm(kmFinal);
    if (fim === null || !(fim > 0)) {
      const err = new Error('Informe a KM da Preventiva (número maior que zero).');
      err.statusCode = 400;
      throw err;
    }
    return;
  }
  const ini = parseKm(kmInicial);
  const fim = parseKm(kmFinal);
  if (ini !== null && fim !== null && fim < ini) {
    const err = new Error(`A KM Final (${fim}) não pode ser menor que a KM Inicial (${ini}).`);
    err.statusCode = 400;
    throw err;
  }
}

function strOuNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// 'YYYY-MM-DD' (calendario da operacao) -> Date UTC a meia-noite, como o
// restante do sistema grava o campo `data`. Retorna null se invalido.
function dataISOParaUTC(iso) {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [ano, mes, dia] = s.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d;
}

function autorDaRequisicao(req, corpo = {}) {
  return (
    corpo.atualizado_por ||
    corpo.criado_por ||
    req.headers['x-acting-matricula'] ||
    req.headers['x-acting-nome'] ||
    null
  );
}

function calcularAderencia(obra, obra_programada) {
  if (!obra || !obra_programada) return null;
  return obra.trim().toUpperCase() === obra_programada.trim().toUpperCase();
}

// Pendência geral do relatório: checklist sem foto de comprovação ou
// atividade com status Pendente (ausente conta como pendente).
function calcularPendencia(checklist = [], atividades = []) {
  const checkPendente = (checklist || []).some((c) => !c || !String(c.foto_url || '').trim());
  const ativPendente = (atividades || []).some((a) => !a || !a.status || a.status === 'Pendente');
  return checkPendente || ativPendente;
}

const INCLUDE_COMPLETO = {
  veiculo: { select: { placa: true, modelo: true, status: true } },
  obra_ref: { select: { id: true, nome: true, numero_contrato: true, contratante: true, gestao: true, planejador: true } },
  mao_obra: { orderBy: { created_at: 'asc' } },
  equipamentos: { orderBy: { created_at: 'asc' } },
  atividades: { orderBy: { created_at: 'asc' } },
  ocorrencias: { orderBy: { created_at: 'asc' } },
  checklist: { orderBy: { created_at: 'asc' } },
  comentarios: { orderBy: { created_at: 'asc' } },
  fotos: { orderBy: { created_at: 'asc' } },
  assinaturas: { orderBy: { created_at: 'asc' } },
  logs: { orderBy: { created_at: 'desc' }, take: 20 },
  _count: {
    select: {
      mao_obra: true,
      equipamentos: true,
      atividades: true,
      ocorrencias: true,
      checklist: true,
      comentarios: true,
      fotos: true,
      assinaturas: true,
      logs: true,
    },
  },
};

async function registrarLog(txOuPrisma, parte_id, acao, autor, detalhes = null) {
  try {
    await txOuPrisma.parteDiariaLog.create({
      data: { parte_id, acao, autor, detalhes },
    });
  } catch (e) {
    console.error('[ParteDiaria] falha ao registrar log:', e.message);
  }
}

// Blindagem anti-502: teto de itens por lista filha e do JSON total.
// Fotos trafegam como URL curta do Cloudinary (via POST /api/upload);
// base64/data-URI é rejeitado em 400 pelo validarUrlMidia.
const LIMITE_ITENS_LISTA = 200;
const LIMITE_PAYLOAD_JSON_BYTES = 8 * 1024 * 1024;

function limitarLista(arr, nome) {
  if (arr.length > LIMITE_ITENS_LISTA) {
    const err = new Error(`Lista \`${nome}\` grande demais (máximo ${LIMITE_ITENS_LISTA} itens por salvamento).`);
    err.statusCode = 400;
    throw err;
  }
  return arr;
}

function validarTamanhoPayload(corpo) {
  let tamanho = 0;
  try {
    tamanho = JSON.stringify(corpo || {}).length;
  } catch {
    const err = new Error('Corpo da requisição inválido (JSON não serializável).');
    err.statusCode = 400;
    throw err;
  }
  if (tamanho > LIMITE_PAYLOAD_JSON_BYTES) {
    const err = new Error(
      'Corpo da requisição grande demais (máximo 8 MB em JSON). Envie fotos via POST /api/upload e persista somente as URLs.'
    );
    err.statusCode = 413;
    throw err;
  }
}

// Normaliza as listas filhas vindas do formulario (ignora linhas vazias).
function normalizarFilhos(corpo = {}) {
  const filhos = {};

  if (Array.isArray(corpo.mao_obra)) {
    filhos.mao_obra = limitarLista(corpo.mao_obra, 'mao_obra')
      .filter((i) => i && String(i.nome || '').trim())
      .map((i) => ({
        nome: String(i.nome).trim(),
        matricula: strOuNull(i.matricula),
        funcao: strOuNull(i.funcao),
        horario: strOuNull(i.horario),
        observacao: strOuNull(i.observacao),
      }));
  }
  if (Array.isArray(corpo.equipamentos)) {
    filhos.equipamentos = limitarLista(corpo.equipamentos, 'equipamentos')
      .filter((i) => i && (String(i.descricao || '').trim() || String(i.tag_patrimonio || '').trim()))
      // descricao é NOT NULL no banco: usa o TAG como fallback quando vazia
      .map((i) => ({
        tag_patrimonio: strOuNull(i.tag_patrimonio),
        descricao: String(i.descricao || i.tag_patrimonio || '').trim(),
        horimetro_inicial: strOuNull(i.horimetro_inicial),
        horimetro_final: strOuNull(i.horimetro_final),
        status: strOuNull(i.status),
      }));
  }
  if (Array.isArray(corpo.atividades)) {
    filhos.atividades = limitarLista(corpo.atividades, 'atividades')
      .filter((i) => i && String(i.descricao || '').trim())
      .map((i) => {
        validarHorario(i.hora_inicio ?? undefined, 'atividades.hora_inicio');
        validarHorario(i.hora_fim ?? undefined, 'atividades.hora_fim');
        return {
          descricao: String(i.descricao).trim(),
          prioridade: strOuNull(i.prioridade),
          local: strOuNull(i.local),
          hora_inicio: strOuNull(i.hora_inicio),
          hora_fim: strOuNull(i.hora_fim),
          status: strOuNull(i.status),
        };
      });
  }
  if (Array.isArray(corpo.ocorrencias)) {
    filhos.ocorrencias = limitarLista(corpo.ocorrencias, 'ocorrencias')
      .filter((i) => i && String(i.descricao || '').trim())
      .map((i) => {
        validarHorario(i.hora ?? undefined, 'ocorrencias.hora');
        return {
          tipo: strOuNull(i.tipo),
          descricao: String(i.descricao).trim(),
          hora: strOuNull(i.hora),
          gravidade: strOuNull(i.gravidade),
        };
      });
  }
  if (Array.isArray(corpo.checklist)) {
    filhos.checklist = limitarLista(corpo.checklist, 'checklist')
      .filter((i) => i && String(i.item || '').trim())
      .map((i) => {
        const fotoUrl = strOuNull(i.foto_url);
        if (fotoUrl) validarUrlMidia(fotoUrl, 'checklist.foto_url');
        return {
          item: String(i.item).trim(),
          conforme: i.conforme === undefined || i.conforme === null ? true : Boolean(i.conforme),
          observacao: strOuNull(i.observacao),
          foto_url: fotoUrl,
          foto_public_id: strOuNull(i.foto_public_id),
        };
      });
  }
  if (Array.isArray(corpo.comentarios)) {
    filhos.comentarios = limitarLista(corpo.comentarios, 'comentarios')
      .filter((i) => i && String(i.texto || '').trim())
      .map((i) => ({
        autor: strOuNull(i.autor),
        texto: String(i.texto).trim(),
      }));
  }
  if (Array.isArray(corpo.fotos)) {
    filhos.fotos = limitarLista(corpo.fotos, 'fotos')
      .filter((i) => i && String(i.url || '').trim())
      .map((i) => {
        validarUrlMidia(String(i.url).trim(), 'fotos.url');
        return {
          url: String(i.url).trim(),
          legenda: strOuNull(i.legenda),
          public_id: strOuNull(i.public_id),
        };
      });
  }
  return filhos;
}

export const listarPartesDiarias = asyncHandler(async (req, res) => {
  const {
    tag,
    data_inicio,
    data_fim,
    status_assinatura,
    status,
    status_operacional,
    status_aprovacao,
    status_relatorio,
    funcionario,
    operador,
    q,
    page = 1,
    limit = 50,
  } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where = {};
  if (tag) where.tag = tag;
  if (status_operacional) {
    where.status_operacional = status_operacional;
  } else if (status) {
    where.OR = [
      { status: status },
      { status_operacional: status },
    ];
  }
  if (status_aprovacao) where.status_aprovacao = status_aprovacao;
  if (status_assinatura) where.status_assinatura = status_assinatura;
  if (status_relatorio) where.status_relatorio = status_relatorio;
  if (funcionario) where.funcionario = { contains: String(funcionario), mode: 'insensitive' };
  if (operador) where.operador = String(operador);
  if (data_inicio || data_fim) {
    where.data = {};
    if (data_inicio) where.data.gte = new Date(data_inicio);
    if (data_fim) where.data.lte = new Date(data_fim);
  }
  // Busca livre: TAG, funcionario, operador, obra, relatorio ou lideranca.
  if (q && String(q).trim()) {
    const termo = String(q).trim();
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { tag: { contains: termo, mode: 'insensitive' } },
          { funcionario: { contains: termo, mode: 'insensitive' } },
          { operador: { contains: termo, mode: 'insensitive' } },
          { obra: { contains: termo, mode: 'insensitive' } },
          { id_relatorio: { contains: termo, mode: 'insensitive' } },
          { numero_relatorio: { contains: termo, mode: 'insensitive' } },
          { lideranca: { contains: termo, mode: 'insensitive' } },
        ],
      },
    ];
  }

  // ==========================================================================
  // ESCOPO POR PAPEL (RBAC) — duas regras estritas:
  //
  // 1) MASTER / ADMIN / TRANSPORTE (tipo ADMINISTRADOR, qualquer nivel/setor):
  //    VISAO GLOBAL TOTAL. A query NAO recebe filtro de usuario_id nem
  //    restricao de status/tipo — retorna TODOS os registros do banco
  //    (preventivas, corretivas, indisponibilidades, interdicoes e
  //    lancamentos de QUALQUER operador). Os unicos filtros possiveis sao
  //    os parametros explicitos opcionais da query string (UI/relatorios).
  //
  // 2) OPERACIONAL comum: ISOLAMENTO OBRIGATORIO — ve e gerencia
  //    exclusivamente os proprios registros (operador = matricula, ou o
  //    nome/matricula embutido em `funcionario`). Aplicado SEMPRE, mesmo
  //    que o cliente nao envie nenhum parametro.
  // ==========================================================================
  const op = sessaoOperacional(req);
  if (op) {
    const escopoOperacional = [
      { operador: op.matricula },
      { funcionario: { contains: op.matricula, mode: 'insensitive' } },
      ...(op.nome
        ? [{ funcionario: { contains: op.nome, mode: 'insensitive' } }]
        : []),
    ];
    where.AND = [
      ...(where.AND || []),
      { OR: escopoOperacional },
    ];
  }

  const [partes, total] = await Promise.all([
    prisma.parteDiaria.findMany({
      where,
      skip,
      take: Number(limit),
      // Regra de ordenacao global: mais recente primeiro (data e, como
      // desempate, o horario de criacao do registro).
      orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
      include: {
        veiculo: { select: { placa: true, modelo: true, status: true } },
        obra_ref: { select: { id: true, nome: true, numero_contrato: true } },
        _count: {
          select: {
            mao_obra: true,
            equipamentos: true,
            atividades: true,
            ocorrencias: true,
            checklist: true,
            comentarios: true,
            fotos: true,
            assinaturas: true,
            logs: true,
          },
        },
      },
    }),
    prisma.parteDiaria.count({ where }),
  ]);

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    data: partes,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

export const buscarUltimaKm = asyncHandler(async (req, res) => {
  // GET /api/partes-diarias/ultima-km?tag=TAG&ignorar_id=ID
  // Herança do odômetro: última km_final do veículo (por data, desempate por created_at).
  const tag = String(req.query.tag || '').trim().toUpperCase();
  if (!tag) {
    return res.status(400).json({ error: 'TAG obrigatoria', message: 'Informe a TAG do veículo (?tag=TAG).' });
  }
  const ignorarId = req.query.ignorar_id || req.query.excluir_id || null;
  const ultima = await obterUltimaKmFinal(tag, ignorarId);
  res.json({
    data: { tag, ...ultima },
  });
});

export const buscarParteDiaria = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parte = await prisma.parteDiaria.findUnique({
    where: { id },
    include: INCLUDE_COMPLETO,
  });

  if (!parte) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
  }

  // Escopo por papel: operacional só abre os próprios registros
  // (bloqueia acesso direto via URL/ID de terceiros).
  const op = sessaoOperacional(req);
  if (op) {
    const mat = op.matricula.toUpperCase();
    const funcionario = String(parte.funcionario || '').toUpperCase();
    const ehMeu =
      String(parte.operador || '').toUpperCase() === mat ||
      funcionario.includes(mat) ||
      (op.nome && funcionario.includes(op.nome.toUpperCase()));
    if (!ehMeu) {
      return res.status(403).json({ error: 'Sem permissao', message: 'Você só pode visualizar suas próprias partes diárias.' });
    }
  }

  // Auditoria: contabiliza visualizacao (rodapé do formulário).
  try {
    await prisma.parteDiaria.update({
      where: { id },
      data: { visualizacoes: { increment: 1 } },
    });
    parte.visualizacoes = (parte.visualizacoes || 0) + 1;
  } catch {
    /* auditoria nao pode quebrar a leitura */
  }

  res.json({ data: enriquecerAssinaturas(parte) });
});

export const criarParteDiaria = asyncHandler(async (req, res) => {
  const {
    tag,
    funcionario,
    funcao,
    obra,
    obra_programada,
    data,
    id_relatorio,
    status,
    lideranca,
    operador,
    eficiencia,
    evidencia_url,
    numero_relatorio,
    numero_contrato,
    endereco_obra,
    contratante,
    responsavel,
    prazo_contratual,
    prazo_decorrido,
    prazo_a_vencer,
    horario_entrada,
    horario_saida,
    intervalo_entrada,
    intervalo_saida,
    status_relatorio,
    status_operacional,
    status_aprovacao,
    turno,
    km_inicial,
    km_final,
    criado_por,
    obra_id,
    planejador,
  } = req.body || {};

  // Blindagem anti-502: rejeita JSON gigante antes de qualquer processamento.
  validarTamanhoPayload(req.body);

  // Derivação a partir dos módulos (novo formulário): TAG do 1º equipamento
  // com TAG; autoria do 1º registro da mão de obra.
  const equipamentosBody = Array.isArray(req.body?.equipamentos) ? req.body.equipamentos : [];
  const maoObraBody = Array.isArray(req.body?.mao_obra) ? req.body.mao_obra : [];
  const veiculoModulo = equipamentosBody.find((e) => e && String(e.tag_patrimonio || '').trim());
  const responsavelModulo = maoObraBody[0] || {};
  const tagFinal = tag || (veiculoModulo ? String(veiculoModulo.tag_patrimonio).trim().toUpperCase() : null);

  // Payload flexível por status (Fase Sênior 3): qualquer status aceita o
  // mínimo (obra + veículo/TAG + status). Checklist, mão de obra, atividades
  // e demais módulos são sempre opcionais — viram `possui_pendencia`/listas
  // vazias quando ausentes. Preventiva exige KM no front (âncora do ciclo).
  const statusOperacionalFinal = status_operacional || status || 'Operação';
  const ehOperacao = statusOperacionalFinal === 'Operação';
  if (!tagFinal || !statusOperacionalFinal) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Informe o status operacional do dia e ao menos um veiculo (TAG em Equipamentos).',
    });
  }
  // Obra obrigatória só em Operação (manutenção/parada aceitam obra null).
  if (ehOperacao && !obra) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Informe a obra para relatórios de Operação.',
    });
  }
  if (!STATUS_OPERACIONAL_VALIDOS.includes(statusOperacionalFinal)) {
    return res.status(400).json({
      error: 'Status invalido',
      message: `status_operacional deve ser um de: ${STATUS_OPERACIONAL_VALIDOS.join(', ')}.`,
    });
  }
  if (status_aprovacao && !STATUS_APROVACAO_VALIDOS.includes(status_aprovacao)) {
    return res.status(400).json({
      error: 'Status invalido',
      message: `status_aprovacao deve ser um de: ${STATUS_APROVACAO_VALIDOS.join(', ')}.`,
    });
  }
  // O TAG referencia a frota (mob_desmob): falha aqui indica veículo fora do cadastro
  try {
    const veiculoExiste = await prisma.mobDesmob.findUnique({ where: { tag: tagFinal } });
    if (!veiculoExiste) {
      return res.status(400).json({
        error: 'Veiculo invalido',
        message: `TAG "${tagFinal}" não encontrada na frota. Selecione um veículo do cadastro em Equipamentos.`,
      });
    }
  } catch (e) {
    console.error("Erro ao salvar Parte Diária:", e);
    return res.status(500).json({
      error: 'Erro interno no servidor',
      message: 'Falha ao validar o veículo na frota. Tente novamente.',
      ...(config.nodeEnv === 'development' && { details: e.message, stack: e.stack }),
    });
  }

  // Regra de ouro: evidencia_url aceita SOMENTE URL do Cloudinary (sem binario).
  validarUrlMidia(evidencia_url, 'evidencia_url');
  validarHorario(horario_entrada ?? undefined, 'horario_entrada');
  validarHorario(horario_saida ?? undefined, 'horario_saida');
  validarHorario(intervalo_entrada ?? undefined, 'intervalo_entrada');
  validarHorario(intervalo_saida ?? undefined, 'intervalo_saida');
  // Trava do odômetro (preventiva: só exige KM Final > 0, sem comparação).
  validarQuilometragem(km_inicial, km_final, statusOperacionalFinal);

  if (status_relatorio && !STATUS_RELATORIO_VALIDOS.includes(status_relatorio)) {
    return res.status(400).json({
      error: 'Status invalido',
      message: `status_relatorio deve ser um de: ${STATUS_RELATORIO_VALIDOS.join(', ')}.`,
    });
  }

  const aderencia = calcularAderencia(obra, obra_programada);

  // Rastreabilidade do autor: corpo > 1º registro da mão de obra >
  // matricula atuante do header (x-acting-matricula) quando presente.
  const operadorFinal = operador
    || (responsavelModulo.matricula ? String(responsavelModulo.matricula).trim() : null)
    || req.headers['x-acting-matricula']
    || null;
  const funcionarioFinal = funcionario
    || (responsavelModulo.nome ? String(responsavelModulo.nome).trim() : null);
  const funcaoFinal = funcao
    || (responsavelModulo.funcao ? String(responsavelModulo.funcao).trim() : null);
  const autor = autorDaRequisicao(req, req.body);

  const dataRef = data ? new Date(data) : new Date();
  const filhos = normalizarFilhos(req.body);
  // IMPORTANTE: o POST e SEMPRE aditivo — cria um registro novo e NUNCA
  // substitui/mescla Partes Diarias existentes (outro status, outro tipo de
  // relatorio ou outro dia). Historico 100% preservado: cada lançamento
  // (Operacao, Preventiva, Corretiva, Indisponibilidade, Interdicao,
  // Nao Operado) coexiste de forma independente na listagem.
  const diaRef = new Date(Date.UTC(dataRef.getUTCFullYear(), dataRef.getUTCMonth(), dataRef.getUTCDate()));

  // Vinculo com o cadastro de Obras (dropdown da Parte Diaria).
  let obraIdFinal = null;
  if (obra_id) {
    const obraExiste = await prisma.obra.findUnique({ where: { id: String(obra_id) } });
    if (!obraExiste) {
      return res.status(400).json({
        error: 'Obra invalida',
        message: 'A obra selecionada nao foi encontrada no cadastro.',
      });
    }
    obraIdFinal = obraExiste.id;
  }

  let pContratual = toIntOuNull(prazo_contratual);
  let pDecorrido = toIntOuNull(prazo_decorrido);
  let pVencer = toIntOuNull(prazo_a_vencer);
  if (pVencer === null && pContratual !== null && pDecorrido !== null) {
    pVencer = Math.max(pContratual - pDecorrido, 0);
  }

  let criado;
  try {
    criado = await prisma.$transaction(async (tx) => {
      const novo = await tx.parteDiaria.create({
        data: {
          tag: tagFinal,
          funcionario: funcionarioFinal,
          funcao: funcaoFinal,
          obra: obra || null,
          obra_programada,
          data: dataRef,
          dia_semana: diaSemanaPT(dataRef),
          id_relatorio,
          numero_relatorio: strOuNull(numero_relatorio) || gerarNumeroRelatorio(),
          numero_contrato: strOuNull(numero_contrato),
          endereco_obra: strOuNull(endereco_obra),
          contratante: strOuNull(contratante),
          responsavel: strOuNull(responsavel),
          prazo_contratual: pContratual,
          prazo_decorrido: pDecorrido,
          prazo_a_vencer: pVencer,
          horario_entrada: strOuNull(horario_entrada),
          horario_saida: strOuNull(horario_saida),
          intervalo_entrada: strOuNull(intervalo_entrada),
          intervalo_saida: strOuNull(intervalo_saida),
          status_operacional: statusOperacionalFinal,
          status_aprovacao: status_aprovacao || 'Em Preenchimento',
          status_relatorio: status_relatorio || statusAprovacaoParaRelatorio(status_aprovacao || 'Em Preenchimento'),
          possui_pendencia: calcularPendencia(filhos.checklist, filhos.atividades),
          obra_id: obraIdFinal,
          planejador: strOuNull(planejador),
          turno: strOuNull(turno),
          km_inicial: strOuNull(km_inicial),
          km_final: strOuNull(km_final),
          status: statusOperacionalFinal,
          lideranca,
          operador: operadorFinal,
          aderencia,
          eficiencia: eficiencia !== undefined && eficiencia !== null && eficiencia !== ''
            ? Number(eficiencia)
            : null,
          evidencia_url,
          criado_por: criado_por || autor,
          atualizado_por: autor,
          ...(filhos.mao_obra ? { mao_obra: { create: filhos.mao_obra } } : {}),
          ...(filhos.equipamentos ? { equipamentos: { create: filhos.equipamentos } } : {}),
          ...(filhos.atividades ? { atividades: { create: filhos.atividades } } : {}),
          ...(filhos.ocorrencias ? { ocorrencias: { create: filhos.ocorrencias } } : {}),
          ...(filhos.checklist ? { checklist: { create: filhos.checklist } } : {}),
          ...(filhos.comentarios ? { comentarios: { create: filhos.comentarios } } : {}),
          ...(filhos.fotos ? { fotos: { create: filhos.fotos } } : {}),
        },
      });
      await registrarLog(tx, novo.id, 'CRIADO', autor, { numero_relatorio: novo.numero_relatorio });
      return novo;
      // Timeout estendido: o Neon (pooler) tem latencia alta no primeiro toque.
    }, { timeout: 30000, maxWait: 15000 });
  } catch (e) {
    console.error("Erro ao salvar Parte Diária:", e);
    return res.status(500).json({
      error: 'Erro interno no servidor',
      message: 'Não foi possível gravar a parte diária no banco de dados. Verifique os campos e tente novamente.',
      ...(config.nodeEnv === 'development' && { details: e.message, stack: e.stack }),
    });
  }

  // Baixa automatica na auditoria de pendencias de lancamento: a criacao do
  // relatorio ja elimina a pendencia derivada; limpa tambem eventual descarte
  // manual e override de operador anteriores para o mesmo veiculo/dia.
  try {
    await Promise.all([
      prisma.pendenciaParteDiariaIgnorada.deleteMany({
        where: { tag: tagFinal, data: diaRef },
      }),
      prisma.pendenciaParteDiariaOperador.deleteMany({
        where: { tag: tagFinal, data: diaRef },
      }),
    ]);
  } catch {
    /* higiene da auditoria nao bloqueia o salvamento */
  }

  const parte = await prisma.parteDiaria.findUnique({ where: { id: criado.id }, include: INCLUDE_COMPLETO });
  res.status(201).json({ data: enriquecerAssinaturas(parte) });
});

// PUT /api/partes-diarias/:id — salvamento em tempo real (autosave).
// Campos simples: atualiza somente as chaves presentes no corpo.
// Listas filhas: quando a chave vem (mesmo vazia), substitui a colecao.
export const atualizarParteDiaria = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const corpo = req.body || {};
  validarTamanhoPayload(corpo);

  const atual = await prisma.parteDiaria.findUnique({ where: { id } });
  if (!atual) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
  }

  const tem = (k) => Object.prototype.hasOwnProperty.call(corpo, k);

  // Regra de ouro: evidencia_url aceita SOMENTE URL do Cloudinary (sem binario).
  if (tem('evidencia_url')) validarUrlMidia(corpo.evidencia_url, 'evidencia_url');
  ['horario_entrada', 'horario_saida', 'intervalo_entrada', 'intervalo_saida'].forEach((k) => {
    if (tem(k)) validarHorario(corpo[k] ?? undefined, k);
  });
  if (tem('status_relatorio') && corpo.status_relatorio && !STATUS_RELATORIO_VALIDOS.includes(corpo.status_relatorio)) {
    return res.status(400).json({
      error: 'Status invalido',
      message: `status_relatorio deve ser um de: ${STATUS_RELATORIO_VALIDOS.join(', ')}.`,
    });
  }
  if (tem('status_operacional') && corpo.status_operacional && !STATUS_OPERACIONAL_VALIDOS.includes(corpo.status_operacional)) {
    return res.status(400).json({
      error: 'Status invalido',
      message: `status_operacional deve ser um de: ${STATUS_OPERACIONAL_VALIDOS.join(', ')}.`,
    });
  }
  if (tem('status_aprovacao') && corpo.status_aprovacao && !STATUS_APROVACAO_VALIDOS.includes(corpo.status_aprovacao)) {
    return res.status(400).json({
      error: 'Status invalido',
      message: `status_aprovacao deve ser um de: ${STATUS_APROVACAO_VALIDOS.join(', ')}.`,
    });
  }
  // Trava do odômetro (PUT parcial: mescla corpo + registro atual).
  // Preventiva: só exige KM Final > 0 (retroativo liberado).
  if (tem('km_inicial') || tem('km_final') || tem('status_operacional')) {
    const statusMerged = tem('status_operacional') && corpo.status_operacional
      ? corpo.status_operacional
      : atual.status_operacional;
    validarQuilometragem(
      tem('km_inicial') ? corpo.km_inicial : atual.km_inicial,
      tem('km_final') ? corpo.km_final : atual.km_final,
      statusMerged,
    );
  }

  // Colunas NOT NULL: nunca persistir null/vazio (evita 500 por constraint violation).
  // Obra só é obrigatória em Operação (manutenção/parada podem limpar).
  const statusEfetivo = tem('status_operacional') && corpo.status_operacional
    ? corpo.status_operacional
    : tem('status') && corpo.status
      ? corpo.status
      : atual.status_operacional;
  const COLUNAS_OBRIGATORIAS = [
    ...(statusEfetivo === 'Operação' ? ['obra'] : []),
    'status', 'status_operacional', 'status_aprovacao', 'status_relatorio',
  ];
  for (const k of COLUNAS_OBRIGATORIAS) {
    if (tem(k) && (corpo[k] === '' || corpo[k] === null || corpo[k] === undefined)) {
      return res.status(400).json({
        error: 'Campo obrigatorio',
        message: `O campo \`${k}\` é obrigatório e não pode ser vazio.`,
      });
    }
  }

  const dados = {};
  const simplesTexto = [
    'funcionario', 'funcao', 'obra', 'obra_programada', 'id_relatorio', 'status',
    'status_operacional', 'status_aprovacao',
    'lideranca', 'operador', 'numero_relatorio', 'numero_contrato', 'endereco_obra',
    'contratante', 'responsavel', 'planejador', 'horario_entrada', 'horario_saida',
    'intervalo_entrada', 'intervalo_saida', 'status_relatorio', 'turno',
    'km_inicial', 'km_final', 'evidencia_url',
  ];
  simplesTexto.forEach((k) => {
    if (tem(k)) dados[k] = corpo[k] === '' ? null : corpo[k];
  });
  if (tem('status_operacional') && dados.status_operacional) {
    dados.status = dados.status_operacional;
  } else if (tem('status') && dados.status) {
    dados.status_operacional = dados.status;
  }
  if (tem('status_aprovacao') && dados.status_aprovacao) {
    dados.status_relatorio = statusAprovacaoParaRelatorio(dados.status_aprovacao);
  }
  if (tem('obra_id')) {
    if (!corpo.obra_id) {
      dados.obra_id = null;
    } else {
      const obraExiste = await prisma.obra.findUnique({ where: { id: String(corpo.obra_id) } });
      if (!obraExiste) {
        return res.status(400).json({
          error: 'Obra invalida',
          message: 'A obra selecionada nao foi encontrada no cadastro.',
        });
      }
      dados.obra_id = obraExiste.id;
    }
  }
  if (tem('dia_semana')) dados.dia_semana = strOuNull(corpo.dia_semana);
  if (tem('data') && corpo.data) {
    const d = new Date(corpo.data);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: 'Data invalida', message: 'Campo `data` invalido.' });
    }
    dados.data = d;
    if (!tem('dia_semana')) dados.dia_semana = diaSemanaPT(d);
  }
  if (tem('eficiencia')) {
    const numEficiencia = Number(corpo.eficiencia);
    dados.eficiencia = corpo.eficiencia === '' || corpo.eficiencia === null || corpo.eficiencia === undefined
      || !Number.isFinite(numEficiencia)
      ? null
      : numEficiencia;
  }
  ['prazo_contratual', 'prazo_decorrido', 'prazo_a_vencer'].forEach((k) => {
    if (tem(k)) dados[k] = toIntOuNull(corpo[k]);
  });
  // Auto-calculo: a vencer = contratual - decorrido (quando nao informado).
  if (!tem('prazo_a_vencer') && (tem('prazo_contratual') || tem('prazo_decorrido'))) {
    const pc = tem('prazo_contratual') ? dados.prazo_contratual : atual.prazo_contratual;
    const pd = tem('prazo_decorrido') ? dados.prazo_decorrido : atual.prazo_decorrido;
    if (pc !== null && pc !== undefined && pd !== null && pd !== undefined) {
      dados.prazo_a_vencer = Math.max(pc - pd, 0);
    }
  }

  const novaObra = tem('obra') ? corpo.obra : atual.obra;
  const novaObraProgramada = tem('obra_programada') ? corpo.obra_programada : atual.obra_programada;
  dados.aderencia = calcularAderencia(novaObra, novaObraProgramada);

  const autor = autorDaRequisicao(req, corpo);
  if (autor) dados.atualizado_por = autor;

  const filhos = normalizarFilhos(corpo);
  const colecoes = ['mao_obra', 'equipamentos', 'atividades', 'ocorrencias', 'checklist', 'comentarios', 'fotos'];
  // Só sincroniza coleções que chegaram como array válido: valores nulos ou
  // mal formatados nunca apagam dados nem quebram o createMany (anti-500)
  const temLista = (k) => Array.isArray(corpo[k]);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.parteDiaria.update({ where: { id }, data: dados });
    // Sincronizacao explicita por colecao (delete + recreate).
    if (temLista('mao_obra')) {
        await tx.parteDiariaMaoObra.deleteMany({ where: { parte_id: id } });
        if (filhos.mao_obra?.length) {
          await tx.parteDiariaMaoObra.createMany({ data: filhos.mao_obra.map((i) => ({ ...i, parte_id: id })) });
        }
      }
      if (temLista('equipamentos')) {
        await tx.parteDiariaEquipamento.deleteMany({ where: { parte_id: id } });
        if (filhos.equipamentos?.length) {
          await tx.parteDiariaEquipamento.createMany({ data: filhos.equipamentos.map((i) => ({ ...i, parte_id: id })) });
        }
      }
      if (temLista('atividades')) {
        await tx.parteDiariaAtividade.deleteMany({ where: { parte_id: id } });
        if (filhos.atividades?.length) {
          await tx.parteDiariaAtividade.createMany({ data: filhos.atividades.map((i) => ({ ...i, parte_id: id })) });
        }
      }
      if (temLista('ocorrencias')) {
        await tx.parteDiariaOcorrencia.deleteMany({ where: { parte_id: id } });
        if (filhos.ocorrencias?.length) {
          await tx.parteDiariaOcorrencia.createMany({ data: filhos.ocorrencias.map((i) => ({ ...i, parte_id: id })) });
        }
      }
      if (temLista('checklist')) {
        await tx.parteDiariaChecklist.deleteMany({ where: { parte_id: id } });
        if (filhos.checklist?.length) {
          await tx.parteDiariaChecklist.createMany({ data: filhos.checklist.map((i) => ({ ...i, parte_id: id })) });
        }
      }
      if (temLista('comentarios')) {
        await tx.parteDiariaComentario.deleteMany({ where: { parte_id: id } });
        if (filhos.comentarios?.length) {
          await tx.parteDiariaComentario.createMany({ data: filhos.comentarios.map((i) => ({ ...i, parte_id: id })) });
        }
      }
      if (temLista('fotos')) {
        await tx.parteDiariaFoto.deleteMany({ where: { parte_id: id } });
        if (filhos.fotos?.length) {
          await tx.parteDiariaFoto.createMany({ data: filhos.fotos.map((i) => ({ ...i, parte_id: id })) });
        }
      }
      await registrarLog(tx, id, tem('status_relatorio') ? 'STATUS_ALTERADO' : 'EDITADO', autor, {
        campos: Object.keys(dados),
        filhos_sincronizados: colecoes.filter((c) => temLista(c)),
      });
      // Timeout estendido: o Neon (pooler) tem latencia alta no primeiro toque.
    }, { timeout: 30000, maxWait: 15000 });
  } catch (e) {
    console.error("Erro ao salvar Parte Diária:", e);
    return res.status(500).json({
      error: 'Erro interno no servidor',
      message: 'Não foi possível atualizar a parte diária no banco de dados. Verifique os campos e tente novamente.',
      ...(config.nodeEnv === 'development' && { details: e.message, stack: e.stack }),
    });
  }

  // Baixa automatica na auditoria de pendencias: qualquer salvamento da Parte
  // Diaria (inclusive autosave de edicao) limpa o descarte manual anterior
  // para o mesmo veiculo/dia do registro.
  try {
    const dataEfetiva = dados.data || atual.data;
    if (dataEfetiva) {
      const diaRefAtual = new Date(Date.UTC(dataEfetiva.getUTCFullYear(), dataEfetiva.getUTCMonth(), dataEfetiva.getUTCDate()));
      const tagEfetiva = dados.tag || atual.tag;
      await Promise.all([
        prisma.pendenciaParteDiariaIgnorada.deleteMany({
          where: { tag: tagEfetiva, data: diaRefAtual },
        }),
        prisma.pendenciaParteDiariaOperador.deleteMany({
          where: { tag: tagEfetiva, data: diaRefAtual },
        }),
      ]);
    }
  } catch {
    /* higiene da auditoria nao bloqueia o salvamento */
  }

  // Recalcula a pendência geral a partir do estado final (checklists + atividades).
  try {
    const [checks, ativs] = await Promise.all([
      prisma.parteDiariaChecklist.findMany({ where: { parte_id: id }, select: { foto_url: true } }),
      prisma.parteDiariaAtividade.findMany({ where: { parte_id: id }, select: { status: true } }),
    ]);
    await prisma.parteDiaria.update({
      where: { id },
      data: { possui_pendencia: calcularPendencia(checks, ativs) },
    });
  } catch {
    /* pendência é informativa: nunca quebra o salvamento */
  }

  const completo = await prisma.parteDiaria.findUnique({ where: { id }, include: INCLUDE_COMPLETO });
  res.json({ data: enriquecerAssinaturas(completo) });
});

export const deletarParteDiaria = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.parteDiaria.delete({ where: { id } });
  res.status(204).send();
});

// ============================================================================
// POST /api/partes-diarias/apontamento-rapido
// Upsert leve usado pela Matriz Calendario do BI de Eficiencia (requerMaster):
// define o status operacional de um veiculo em um dia sem passar pelo
// formulario completo.
//   - Registro(s) existente(s) do (TAG, dia): atualiza SOMENTE a classificacao
//     do dia (status_operacional + status legado) e a observacao rapida; o
//     fluxo de aprovacao e os demais campos ficam intactos. Atualiza todos os
//     lancamentos do dia para o BI nunca manter o pior caso antigo.
//   - Sem registro: cria um registro minimo ja aprovado (mesma modelagem da
//     importacao de historico) e limpa descarte/override de pendencia.
// Body: { tag, data: 'YYYY-MM-DD', status_operacional, observacao? }
// ============================================================================
export const apontamentoRapido = asyncHandler(async (req, res) => {
  const tagBruta = strOuNull(req.body?.tag);
  const dataISO = strOuNull(req.body?.data);
  const novoStatus = strOuNull(req.body?.status_operacional) || strOuNull(req.body?.status);
  const temObservacao = Object.prototype.hasOwnProperty.call(req.body || {}, 'observacao');
  const observacaoRapida = temObservacao ? strOuNull(req.body?.observacao) : undefined;

  if (!tagBruta) {
    return res.status(400).json({ error: 'Campos obrigatorios', message: 'Informe a TAG do veiculo.' });
  }
  const diaData = dataISOParaUTC(dataISO);
  if (!diaData) {
    return res.status(400).json({ error: 'Data invalida', message: 'Informe `data` no formato YYYY-MM-DD.' });
  }
  if (!novoStatus || !STATUS_OPERACIONAL_VALIDOS.includes(novoStatus)) {
    return res.status(400).json({
      error: 'Status invalido',
      message: `status_operacional deve ser um de: ${STATUS_OPERACIONAL_VALIDOS.join(', ')}.`,
    });
  }
  if (observacaoRapida && observacaoRapida.length > 2000) {
    return res.status(400).json({
      error: 'Observacao muito longa',
      message: 'A observação rápida deve ter no máximo 2000 caracteres.',
    });
  }

  const veiculo = await prisma.mobDesmob.findFirst({
    where: { tag: { equals: tagBruta, mode: 'insensitive' } },
  });
  if (!veiculo) {
    return res.status(400).json({
      error: 'Veiculo invalido',
      message: `TAG "${tagBruta}" não encontrada na frota. Selecione um veículo da matriz.`,
    });
  }

  const autor = autorDaRequisicao(req, req.body || {})
    || req.atuante?.matricula
    || req.atuante?.nome
    || null;

  const existentes = await prisma.parteDiaria.findMany({
    where: { tag: { equals: veiculo.tag, mode: 'insensitive' }, data: diaData },
    select: { id: true, status_operacional: true },
    orderBy: { created_at: 'asc' },
  });

  if (existentes.length) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const parte of existentes) {
          await tx.parteDiaria.update({
            where: { id: parte.id },
            data: {
              status_operacional: novoStatus,
              status: novoStatus,
              ...(observacaoRapida !== undefined ? { observacao_rapida: observacaoRapida } : {}),
              ...(autor ? { atualizado_por: autor } : {}),
            },
          });
          await registrarLog(tx, parte.id, 'APONTAMENTO_RAPIDO', autor, {
            de: parte.status_operacional,
            para: novoStatus,
            ...(observacaoRapida !== undefined ? { observacao: observacaoRapida } : {}),
            origem: 'matriz-calendario',
          });
        }
        // Timeout estendido: o Neon (pooler) tem latencia alta no primeiro toque.
      }, { timeout: 30000, maxWait: 15000 });
    } catch (e) {
      console.error('Erro no apontamento rapido:', e);
      return res.status(500).json({
        error: 'Erro interno no servidor',
        message: 'Não foi possível atualizar o apontamento. Tente novamente.',
        ...(config.nodeEnv === 'development' && { details: e.message, stack: e.stack }),
      });
    }
    return res.json({
      data: {
        tag: veiculo.tag,
        data: dataISO,
        status_operacional: novoStatus,
        observacao: observacaoRapida ?? null,
        atualizados: existentes.length,
        criado: false,
      },
    });
  }

  let criado;
  try {
    criado = await prisma.parteDiaria.create({
      data: {
        tag: veiculo.tag,
        data: diaData,
        dia_semana: diaSemanaPT(diaData),
        status: novoStatus,
        status_operacional: novoStatus,
        status_aprovacao: 'Aprovado',
        status_relatorio: 'APROVADO',
        status_assinatura: 'APROVADO',
        observacao_rapida: observacaoRapida ?? null,
        possui_pendencia: false,
        criado_por: autor,
        atualizado_por: autor,
      },
    });
  } catch (e) {
    console.error('Erro no apontamento rapido:', e);
    return res.status(500).json({
      error: 'Erro interno no servidor',
      message: 'Não foi possível gravar o apontamento no banco de dados. Tente novamente.',
      ...(config.nodeEnv === 'development' && { details: e.message, stack: e.stack }),
    });
  }

  await registrarLog(prisma, criado.id, 'APONTAMENTO_RAPIDO', autor, {
    para: novoStatus,
    ...(observacaoRapida !== undefined ? { observacao: observacaoRapida } : {}),
    origem: 'matriz-calendario',
    criado: true,
  });

  // Baixa automatica na auditoria de pendencias de lancamento (mesma regra do
  // POST /): o lancamento elimina a pendencia derivada e o descarte manual.
  try {
    await Promise.all([
      prisma.pendenciaParteDiariaIgnorada.deleteMany({
        where: { tag: { equals: veiculo.tag, mode: 'insensitive' }, data: diaData },
      }),
      prisma.pendenciaParteDiariaOperador.deleteMany({
        where: { tag: { equals: veiculo.tag, mode: 'insensitive' }, data: diaData },
      }),
    ]);
  } catch {
    /* higiene da auditoria nao bloqueia o salvamento */
  }

  return res.status(201).json({
    data: {
      tag: veiculo.tag,
      data: dataISO,
      status_operacional: novoStatus,
      observacao: observacaoRapida ?? null,
      atualizados: 0,
      criado: true,
    },
  });
});

// POST /api/partes-diarias/:id/evidencia — campo `arquivo` (imagem).
// Sobe para omegatrack/partes-diarias e grava a secure_url em `evidencia_url`.
export const anexarEvidencia = (req, res, next) => {
  if (!cloudinaryConfigured) {
    return res.status(503).json({
      error: 'Servico indisponivel',
      message: 'Upload de midia nao configurado (variaveis CLOUDINARY_* ausentes).',
    });
  }
  uploadMiddleware('partes-diarias')(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          err.message = 'Arquivo muito grande. Tamanho maximo: 5 MB.';
        }
        err.statusCode = err.statusCode || 400;
        throw err;
      }
      if (!req.file) {
        return res.status(400).json({
          error: 'Arquivo ausente',
          message: 'Envie a evidencia no campo `arquivo` (multipart/form-data).',
        });
      }
      const parte = await prisma.parteDiaria.update({
        where: { id: req.params.id },
        data: { evidencia_url: req.file.path },
      });
      return res.json({
        data: { id: parte.id, evidencia_url: parte.evidencia_url, public_id: req.file.filename },
      });
    } catch (e) {
      return next(e);
    }
  });
};

// POST /api/partes-diarias/:id/fotos — campo `arquivo` (imagem) + `legenda`.
// Sobe para omegatrack/partes-diarias e cria um item na galeria do relatorio.
export const anexarFoto = (req, res, next) => {
  if (!cloudinaryConfigured) {
    return res.status(503).json({
      error: 'Servico indisponivel',
      message: 'Upload de midia nao configurado (variaveis CLOUDINARY_* ausentes).',
    });
  }
  uploadMiddleware('partes-diarias')(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          err.message = 'Arquivo muito grande. Tamanho maximo: 5 MB.';
        }
        err.statusCode = err.statusCode || 400;
        throw err;
      }
      if (!req.file) {
        return res.status(400).json({
          error: 'Arquivo ausente',
          message: 'Envie a foto no campo `arquivo` (multipart/form-data).',
        });
      }
      const existe = await prisma.parteDiaria.findUnique({ where: { id: req.params.id } });
      if (!existe) {
        return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
      }
      const foto = await prisma.parteDiariaFoto.create({
        data: {
          parte_id: req.params.id,
          url: req.file.path,
          legenda: strOuNull(req.body?.legenda),
          public_id: req.file.filename || null,
        },
      });
      await registrarLog(
        prisma,
        req.params.id,
        'FOTO_ADICIONADA',
        autorDaRequisicao(req, req.body || {}),
        { foto_id: foto.id }
      );
      return res.status(201).json({ data: foto });
    } catch (e) {
      return next(e);
    }
  });
};

export const listarPendentesAssinatura = asyncHandler(async (req, res) => {
  const { tag, data_inicio, data_fim, page = 1, limit = 50 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where = {
    status_assinatura: 'PENDENTE',
  };
  if (tag) where.tag = tag;
  if (data_inicio || data_fim) {
    where.data = {};
    if (data_inicio) where.data.gte = new Date(data_inicio);
    if (data_fim) where.data.lte = new Date(data_fim);
  }

  const [partes, total] = await Promise.all([
    prisma.parteDiaria.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { data: 'asc' },
      include: {
        veiculo: { select: { tag: true, placa: true, modelo: true } },
      },
    }),
    prisma.parteDiaria.count({ where }),
  ]);

  res.json({
    data: partes,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

export const assinarParteDiaria = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { assinatura_base64, assinado_por, observacao } = req.body;

  if (!assinatura_base64 || !assinado_por) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Os campos assinatura_base64 e assinado_por sao obrigatorios.',
    });
  }

  const atual = await prisma.parteDiaria.findUnique({ where: { id } });
  if (!atual) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
  }

  if (atual.status_assinatura === 'ASSINADO') {
    return res.status(409).json({
      error: 'Conflito',
      message: 'Esta parte diaria ja foi assinada.',
    });
  }

  const assinatura_dados = {
    assinado_por,
    data_hora: new Date().toISOString(),
    assinatura_base64,
    observacao: observacao || null,
  };

  const parte = await prisma.parteDiaria.update({
    where: { id },
    data: {
      status_assinatura: 'ASSINADO',
      assinatura_dados,
    },
  });

  res.json({ data: parte });
});

// POST /api/partes-diarias/:id/assinaturas — fluxo em 3 etapas.
// Body: { etapa: OPERADOR|TRANSPORTE|PLANEJADOR, nome, matricula?, assinatura_dado?
//   (aliases: assinatura_url, assinatura_base64, dataUrl) }
export const assinarEtapa = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const corpo = req.body || {};
  const { etapa, nome, matricula } = corpo;
  // Compat frontend: aceita assinatura_dado, assinatura_url, assinatura_base64 ou dataUrl
  const assinaturaDadoFinal = corpo.assinatura_dado
    || corpo.assinatura_url
    || corpo.assinatura_base64
    || corpo.dataUrl
    || null;

  if (!etapa || !ETAPAS_ASSINATURA.includes(String(etapa).toUpperCase())) {
    return res.status(400).json({
      error: 'Etapa invalida',
      message: `etapa deve ser uma de: ${ETAPAS_ASSINATURA.join(', ')}.`,
    });
  }
  if (!nome || !String(nome).trim()) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'O campo nome (responsavel pela assinatura) e obrigatorio.',
    });
  }

  const existe = await prisma.parteDiaria.findUnique({
    where: { id },
    include: { assinaturas: true },
  });
  if (!existe) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
  }

  const etapaNorm = String(etapa).toUpperCase();
  const autor = autorDaRequisicao(req, req.body || {}) || String(nome).trim();

  const assinaturaDadoStr = assinaturaDadoFinal ? String(assinaturaDadoFinal) : null;
  await prisma.parteDiariaAssinatura.upsert({
    where: { parte_id_etapa: { parte_id: id, etapa: etapaNorm } },
    update: {
      nome: String(nome).trim(),
      matricula: strOuNull(matricula),
      assinatura_dado: assinaturaDadoStr,
      assinado_em: new Date(),
    },
    create: {
      parte_id: id,
      etapa: etapaNorm,
      nome: String(nome).trim(),
      matricula: strOuNull(matricula),
      assinatura_dado: assinaturaDadoStr,
      assinado_em: new Date(),
    },
  });

  const todasAssinaturas = await prisma.parteDiariaAssinatura.findMany({ where: { parte_id: id } });
  const statusAprovacao = calcularStatusAprovacao(todasAssinaturas);
  const fluxo = statusAprovacaoParaRelatorio(statusAprovacao);

  await prisma.parteDiaria.update({
    where: { id },
    data: {
      status_aprovacao: statusAprovacao,
      status_relatorio: fluxo,
      status_assinatura: statusAprovacao === 'Aprovado' ? 'ASSINADO' : 'PENDENTE',
      atualizado_por: autor,
    },
  });
  await registrarLog(prisma, id, `ASSINATURA_${etapaNorm}`, autor, { etapa: etapaNorm, status_aprovacao: statusAprovacao });

  const completo = await prisma.parteDiaria.findUnique({ where: { id }, include: INCLUDE_COMPLETO });
  res.json({ data: enriquecerAssinaturas(completo) });
});

// DELETE /api/partes-diarias/:id/assinaturas/:etapa — remove uma etapa.
export const removerAssinatura = asyncHandler(async (req, res) => {
  const { id, etapa } = req.params;
  const etapaNorm = String(etapa || '').toUpperCase();
  if (!ETAPAS_ASSINATURA.includes(etapaNorm)) {
    return res.status(400).json({
      error: 'Etapa invalida',
      message: `etapa deve ser uma de: ${ETAPAS_ASSINATURA.join(', ')}.`,
    });
  }
  const existe = await prisma.parteDiaria.findUnique({ where: { id } });
  if (!existe) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
  }
  await prisma.parteDiariaAssinatura.deleteMany({ where: { parte_id: id, etapa: etapaNorm } });
  const restantes = await prisma.parteDiariaAssinatura.findMany({ where: { parte_id: id } });
  const statusAprovacao = calcularStatusAprovacao(restantes);
  const fluxo = statusAprovacaoParaRelatorio(statusAprovacao);

  await prisma.parteDiaria.update({
    where: { id },
    data: {
      status_aprovacao: statusAprovacao,
      status_relatorio: fluxo,
      status_assinatura: statusAprovacao === 'Aprovado' ? 'ASSINADO' : 'PENDENTE',
    },
  });
  const autor = autorDaRequisicao(req, {});
  await registrarLog(prisma, id, `ASSINATURA_REMOVIDA_${etapaNorm}`, autor, { etapa: etapaNorm, status_aprovacao: statusAprovacao });
  const completo = await prisma.parteDiaria.findUnique({ where: { id }, include: INCLUDE_COMPLETO });
  res.json({ data: enriquecerAssinaturas(completo) });
});

// GET /api/partes-diarias/:id/logs — auditoria (log de edicoes).
export const listarLogs = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existe = await prisma.parteDiaria.findUnique({ where: { id } });
  if (!existe) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Parte diaria nao encontrada.' });
  }
  const logs = await prisma.parteDiariaLog.findMany({
    where: { parte_id: id },
    orderBy: { created_at: 'desc' },
    take: 50,
  });
  res.json({ data: logs });
});
