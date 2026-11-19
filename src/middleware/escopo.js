// ============================================================================
// Escopo por contrato.
//   - Cada usuario pertence a UM contrato (3 digitos).
//   - Quem nao e MASTER so enxerga/altera dados do proprio contrato; o
//     parametro `contrato` enviado pelo cliente e ignorado.
//   - MASTER enxerga todos os contratos: `?contrato=010` escolhe um,
//     `?contrato=todos` junta tudo; sem parametro vale o contrato do proprio
//     Master (o filtro dos dashboards ja vem pre-definido nele).
// Registro de outro contrato responde 404 (nao revela que ele existe).
// ============================================================================
import prisma from '../config/database.js';
import { lerSessao, buscarUsuarioPorId } from './sessao.js';
import { contratoValido, exigirContrato } from '../utils/contrato.js';
import { contextoDados } from '../config/escopoDados.js';

export function ehMaster(usuario) {
  return !!usuario && usuario.tipo === 'ADMINISTRADOR' && usuario.nivel === 'MASTER';
}

function erroHttp(status, error, message) {
  const erro = new Error(message);
  erro.statusCode = status;
  erro.error = error;
  return erro;
}

// Carrega o usuario do JWT (se houver) sem exigir login: cada rota continua
// decidindo sozinha se responde 401. Permite que os `router.param` de escopo
// ja saibam o contrato de quem chama.
export async function sessaoOpcional(req, _res, next) {
  try {
    if (!req.atuante) {
      const sessao = lerSessao(req);
      if (sessao?.sub) {
        const usuario = await buscarUsuarioPorId(sessao.sub);
        if (usuario) req.atuante = usuario;
      }
    }
    next();
  } catch (erro) {
    next(erro);
  }
}

/** { contrato, todos, master } do usuario autenticado nesta requisicao. */
export function escopoDaRequisicao(req) {
  const usuario = req.atuante;
  if (!usuario) throw erroHttp(401, 'Nao autenticado', 'Sessao ausente ou invalida. Faca login.');
  if (!ehMaster(usuario)) return { contrato: usuario.contrato, todos: false, master: false };

  const pedido = String(req.query?.contrato ?? '').trim().toLowerCase();
  if (pedido === 'todos') return { contrato: null, todos: true, master: true };
  if (contratoValido(pedido)) return { contrato: pedido, todos: false, master: true };
  return { contrato: usuario.contrato, todos: false, master: true };
}

/** Contrato para filtrar (string) ou undefined quando o Master pediu "todos". */
export function contratoDoEscopo(req) {
  const escopo = escopoDaRequisicao(req);
  return escopo.todos ? undefined : escopo.contrato;
}

/** Fragmento de `where` do Prisma: { contrato } ou {} (Master em "todos"). */
export function filtroContrato(req, campo = 'contrato') {
  const contrato = contratoDoEscopo(req);
  return contrato === undefined ? {} : { [campo]: contrato };
}

/**
 * Contrato a gravar num registro novo.
 * Nao-Master: sempre o proprio (pedir outro = 403).
 * Master: o informado; sem informar, o do filtro atual (em "todos" tem que escolher).
 */
export function contratoParaGravar(req, informado) {
  const escopo = escopoDaRequisicao(req);
  const semValor = informado === undefined || informado === null || String(informado).trim() === '';
  if (!escopo.master) {
    if (!semValor && String(informado).trim() !== escopo.contrato) {
      throw erroHttp(403, 'Sem permissao', 'Você só pode lançar dados no seu próprio contrato.');
    }
    return exigirContrato(escopo.contrato, 'Contrato do seu usuário');
  }
  if (!semValor) return exigirContrato(String(informado));
  if (escopo.todos) {
    throw erroHttp(400, 'Contrato obrigatorio', 'Selecione um contrato (o filtro está em "Todos os contratos").');
  }
  return exigirContrato(escopo.contrato);
}

/** Contrato do registro e acessivel a quem esta logado? */
export function podeAcessarContrato(req, contratoDoRegistro) {
  const usuario = req.atuante;
  if (!usuario) return false;
  return ehMaster(usuario) || contratoDoRegistro === usuario.contrato;
}

/** Lanca 404 quando o registro e de outro contrato. */
export function exigirAcessoContrato(req, contratoDoRegistro) {
  if (!podeAcessarContrato(req, contratoDoRegistro)) {
    throw erroHttp(404, 'Nao encontrado', 'Registro nao encontrado.');
  }
}

/**
 * Callback para `router.param('id', paramContrato(buscar))`: `buscar(valor)`
 * devolve o contrato do registro (ou null/undefined se nao existir — o handler
 * responde o 404 de sempre). Registro de outro contrato => 404.
 * Sem usuario carregado (rota por chave de API etc.), nao interfere.
 */
export function paramContrato(buscar) {
  return async (req, res, next, valor) => {
    try {
      if (!req.atuante || ehMaster(req.atuante)) return next();
      const contrato = await buscar(valor, req);
      if (contrato && contrato !== req.atuante.contrato) {
        return res.status(404).json({ error: 'Nao encontrado', message: 'Registro nao encontrado.' });
      }
      return next();
    } catch (erro) {
      return next(erro);
    }
  };
}

/**
 * Contratos que o usuario pode escolher no filtro. O contrato "existe" a partir
 * do primeiro usuario/veiculo cadastrado com ele (nao ha cadastro de contratos).
 * Nao-Master: so o proprio. Master: todos.
 */
export async function contratosDisponiveis(req) {
  const usuario = req.atuante;
  if (!ehMaster(usuario)) return usuario?.contrato ? [usuario.contrato] : [];
  const [deUsuarios, deVeiculos] = await Promise.all([
    prisma.usuario.groupBy({ by: ['contrato'] }),
    prisma.mobDesmob.groupBy({ by: ['contrato'] }),
  ]);
  return [...new Set([...deUsuarios, ...deVeiculos].map((linha) => linha.contrato).filter(Boolean))].sort();
}

/**
 * Middleware: grava o contrato do escopo em `req.query.__contrato`, de onde os
 * montadores de filtro (ex.: telemetria `montarFiltro`) o aplicam em TODA
 * consulta derivada da query. Qualquer `__contrato` vindo do cliente e descartado.
 */
export function escopoNaQuery(req, _res, next) {
  const query = { ...req.query };
  delete query.__contrato;
  if (req.atuante) {
    const contrato = contratoDoEscopo(req);
    if (contrato) query.__contrato = contrato;
  }
  req.query = query;
  next();
}

/**
 * Define o contexto de dados da requisicao (AsyncLocalStorage): quem nao e Master
 * fica RESTRITO ao proprio contrato em toda consulta ao banco (ver config/escopoDados.js).
 * Sem usuario (rotas publicas/chave de API) ou Master: sem restricao automatica.
 * Contrato ausente no usuario = fecha tudo (contrato vazio nao casa com nada).
 */
export function contextoDeDados(req, _res, next) {
  const usuario = req.atuante;
  req.contextoDados = usuario && !ehMaster(usuario)
    ? { restrito: true, contrato: usuario.contrato || '' }
    : { restrito: false };
  contextoDados.run(req.contextoDados, next);
}
