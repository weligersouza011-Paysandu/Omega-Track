// ============================================================================
// Trava automatica de contrato NA CAMADA DE DADOS (defesa em profundidade).
//
// Os controllers ja filtram por contrato, mas um filtro esquecido numa consulta
// nova vazaria dados. Aqui o cliente Prisma aplica o contrato sozinho: para quem
// NAO e Master, toda leitura/escrita de modelo com contrato recebe `contrato = X`
// (ou o filtro equivalente por relacao), e criar/alterar registro de outro
// contrato e recusado. O Master nao e restringido (o filtro dele e de visao).
//
// Contexto por requisicao via AsyncLocalStorage:
//   { restrito: true, contrato }  -> usuario comum autenticado
//   sem contexto / { restrito: false } -> Master, rotas sem login (chave de API),
//                                          scripts e jobs de sistema.
// O controle de acesso das rotas sem login continua sendo a autenticacao delas.
// ============================================================================
import { AsyncLocalStorage } from 'node:async_hooks';
import { invalidarCacheUsuarios } from './cacheUsuario.js';

export const contextoDados = new AsyncLocalStorage();

/**
 * Executa `fn` com o contexto de dados dado.
 * ATENCAO: consultas do Prisma so rodam quando alguem faz `await`/`.then` nelas. Por isso o
 * `await` e feito AQUI, dentro do contexto — senao uma consulta devolvida sem await sairia do
 * contexto e rodaria sob o contexto de quem chamou (sem a trava, ou sem o bypass pretendido).
 */
export function executarComContexto(contexto, fn) {
  return contextoDados.run(contexto, async () => await fn());
}

/**
 * Consulta GLOBAL deliberada (ex.: garantir que uma TAG nao exista em nenhum
 * contrato). Use so quando o resultado nao for devolvido ao usuario.
 */
export function semEscopo(fn) {
  return executarComContexto({ restrito: false }, fn);
}

/** Reentra no contexto da requisicao (callbacks de stream/multer perdem o contexto). */
export function comContextoDaRequisicao(req, fn) {
  const contexto = req?.contextoDados;
  if (!contexto) return fn;
  return (...args) => contextoDados.run(contexto, async () => await fn(...args));
}

// Modelos com a coluna `contrato`.
const POR_CAMPO = new Set([
  'MobDesmob', 'ParteDiaria', 'Obra', 'VeiculoTerceiro', 'ProgramacaoRecurso', 'ProgramacaoRecursoTerceiro',
  'EventoTelemetria', 'PlanoAcaoTelemetria', 'Residuo', 'ConsumoAgua', 'AtoAutorizativo', 'ProdutoQuimico',
  'Abastecimento', 'Usuario', 'LogAtividade',
]);
// Regras de preventiva: `contrato` nulo = regra global (todos leem; so o proprio contrato escreve).
const GLOBAL_NULO = new Set(['ParametroPreventiva']);
// Modelos que herdam o contrato de uma relacao.
const POR_RELACAO = {
  DocumentacaoVeiculo: 'veiculo',
  MonitoramentoFumacaPreta: 'veiculo',
  ManutencaoRecurso: 'equipamento',
  ParteDiariaMaoObra: 'parte',
  ParteDiariaEquipamento: 'parte',
  ParteDiariaAtividade: 'parte',
  ParteDiariaOcorrencia: 'parte',
  ParteDiariaChecklist: 'parte',
  ParteDiariaComentario: 'parte',
  ParteDiariaFoto: 'parte',
  ParteDiariaAssinatura: 'parte',
  ParteDiariaLog: 'parte',
};

const ESCRITAS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

const OPERACOES_COM_WHERE = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
]);

function erroForaDoContrato() {
  const erro = new Error('Operação fora do contrato do usuário.');
  erro.statusCode = 403;
  erro.error = 'Sem permissao';
  return erro;
}

/** Filtro de contrato do modelo, ou null se o modelo nao e escopado. */
export function filtroDoModelo(model, contrato) {
  if (POR_CAMPO.has(model)) return { contrato };
  if (GLOBAL_NULO.has(model)) return { OR: [{ contrato }, { contrato: null }] };
  if (POR_RELACAO[model]) return { [POR_RELACAO[model]]: { contrato } };
  return null;
}

const comContrato = (model) => POR_CAMPO.has(model) || GLOBAL_NULO.has(model);

function juntarWhere(where, filtro) {
  const existente = where?.AND === undefined ? [] : [].concat(where.AND);
  return { ...(where || {}), AND: [...existente, filtro] };
}

function forcarContrato(dado, contrato) {
  if (dado.contrato === undefined || dado.contrato === null) return { ...dado, contrato };
  if (dado.contrato !== contrato) throw erroForaDoContrato();
  return dado;
}

function proibirTroca(dado, contrato) {
  if (!dado || dado.contrato === undefined) return dado;
  const valor = typeof dado.contrato === 'object' && dado.contrato !== null ? dado.contrato.set : dado.contrato;
  if (valor !== contrato) throw erroForaDoContrato();
  return dado;
}

/** Devolve o cliente Prisma com a trava de contrato aplicada. */
export function aplicarEscopo(prismaBase) {
  return prismaBase.$extends({
    name: 'escopo-por-contrato',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const resultado = await executar({ model, operation, args, query });
          // Usuario mudou (nivel, setor, contrato, assinatura, exclusao...): o cache da sessao nao vale mais.
          if (model === 'Usuario' && ESCRITAS.has(operation)) invalidarCacheUsuarios();
          return resultado;
        },
      },
    },
  });
}

// Leituras afetadas pelo filtro de frota da telemetria.
const LEITURAS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);

/**
 * Telas de telemetria: só eventos de veículos MOBILIZADOS do contrato (lista de TAGs
 * posta no contexto por `somenteFrotaMobilizada`). Vale para Master também.
 */
export function aplicarFiltroFrota({ model, operation, args }, contexto) {
  const frota = contexto?.frotaTelemetria;
  if (!frota || model !== 'EventoTelemetria' || !LEITURAS.has(operation)) return args;
  return { ...(args || {}), where: juntarWhere(args?.where, { tag: { in: frota } }) };
}

async function executar({ model, operation, args: argsOriginais, query }) {
  const contexto = contextoDados.getStore();
  const args = aplicarFiltroFrota({ model, operation, args: argsOriginais }, contexto);
  if (!contexto?.restrito) return query(args);
  const filtro = filtroDoModelo(model, contexto.contrato);
  if (!filtro) return query(args);

  const novo = { ...(args || {}) };
  if (OPERACOES_COM_WHERE.has(operation)) novo.where = juntarWhere(novo.where, filtro);

  if (comContrato(model)) {
    if (operation === 'create') novo.data = forcarContrato(novo.data, contexto.contrato);
    if (operation === 'createMany' || operation === 'createManyAndReturn') {
      novo.data = [].concat(novo.data).map((item) => forcarContrato(item, contexto.contrato));
    }
    if (operation === 'upsert') {
      novo.create = forcarContrato(novo.create, contexto.contrato);
      novo.update = proibirTroca(novo.update, contexto.contrato);
    }
    if (operation === 'update' || operation === 'updateMany') {
      novo.data = proibirTroca(novo.data, contexto.contrato);
    }
  }
  return query(novo);
}
