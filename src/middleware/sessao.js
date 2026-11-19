// ============================================================================
// src/middleware/sessao.js — Sessao JWT (login de administradores).
// Header: `Authorization: Bearer <token>` (12h). A identidade vem SOMENTE do
// JWT assinado: o header legado `x-acting-matricula` nao autentica mais ninguem
// (bastava conhecer a matricula de um Master para se passar por ele).
// ============================================================================
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import prisma from '../config/database.js';
import { ehSetorGestao } from '../utils/setores.js';
import { TTL_USUARIO_MS, lerUsuarioDoCache, guardarUsuarioNoCache } from '../config/cacheUsuario.js';

export function assinarSessao(usuario) {
  return jwt.sign(
    { sub: usuario.id, matricula: usuario.matricula, nome: usuario.nome, tipo: usuario.tipo, setor: usuario.setor, nivel: usuario.nivel, contrato: usuario.contrato },
    config.loginSecret,
    { expiresIn: '12h' }
  );
}

// Sessão operacional extraída do JWT (para escopo de dados). Retorna
// { matricula, nome } quando o token é de um OPERACIONAL, ou null.
export function sessaoOperacional(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const sessao = jwt.verify(auth.slice(7).trim(), config.loginSecret);
    if (sessao?.tipo === 'OPERACIONAL' && sessao?.matricula) {
      return { matricula: String(sessao.matricula), nome: sessao.nome ? String(sessao.nome) : null };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Usuario da sessao por id, com cache curtissimo (ver config/cacheUsuario.js). Sem cache
 * quando o cliente do banco e um stub de teste (nao tem $extends).
 */
export async function buscarUsuarioPorId(id) {
  const usaCache = TTL_USUARIO_MS > 0 && typeof prisma.$extends === 'function';
  if (usaCache) {
    const guardado = lerUsuarioDoCache(id);
    if (guardado) return guardado;
  }
  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (usaCache) guardarUsuarioNoCache(id, usuario);
  return usuario;
}

export function lerSessao(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7).trim(), config.loginSecret);
  } catch {
    return null;
  }
}

// Administrador autenticado pelo JWT (ou null).
export async function atuanteDaRequisicao(req) {
  if (req.atuante?.tipo === 'ADMINISTRADOR') return req.atuante; // ja carregado pelo JWT
  const sessao = lerSessao(req);
  if (!sessao?.sub) return null;
  const u = await buscarUsuarioPorId(sessao.sub);
  return u && u.tipo === 'ADMINISTRADOR' ? u : null;
}

// Sessão autenticada de qualquer perfil (admin ou operacional), sempre pelo JWT.
export async function requerSessao(req, res, next) {
  if (req.atuante) return next(); // ja carregado do JWT por sessaoOpcional
  const sessao = lerSessao(req);
  const usuario = sessao?.sub
    ? await buscarUsuarioPorId(sessao.sub)
    : null;
  if (!usuario) {
    return res.status(401).json({
      error: 'Nao autenticado',
      message: 'Sessao ausente ou invalida. Faca login.',
    });
  }

  req.atuante = usuario;
  next();
}

export async function requerAdmin(req, res, next) {
  const atuante = await atuanteDaRequisicao(req);
  if (!atuante) {
    return res.status(401).json({
      error: 'Nao autenticado',
      message: 'Sessao ausente ou invalida. Faca login.',
    });
  }
  req.atuante = atuante;
  next();
}

// Rotas novas que exigem a identidade assinada da sessao, sem o fallback
// legado de matricula informado pelo cliente.
export async function requerAdminAutenticado(req, res, next) {
  const sessao = lerSessao(req);
  if (!sessao?.sub) {
    return res.status(401).json({
      error: 'Nao autenticado',
      message: 'Sessao ausente ou invalida. Faca login.',
    });
  }
  const usuario = await buscarUsuarioPorId(sessao.sub);
  if (!usuario || usuario.tipo !== 'ADMINISTRADOR') {
    return res.status(403).json({
      error: 'Sem permissao',
      message: 'Apenas administradores podem acessar a programacao.',
    });
  }
  req.atuante = usuario;
  next();
}

// Quem pode alterar a Programacao de Recursos (e cadastrar operador/supervisor
// por ela). Usar depois de requerAdminAutenticado (precisa de req.atuante).
export function requerGestaoTransporte(req, res, next) {
  const usuario = req.atuante;
  if (usuario?.nivel !== 'MASTER' && !ehSetorGestao(usuario?.setor) && usuario?.setor !== 'TRANSPORTE') {
    return res.status(403).json({
      error: 'Sem permissao',
      message: 'Apenas Gestao, Transporte ou ADM Master podem alterar a programacao.',
    });
  }
  next();
}

// Aprovacao em lote das Partes Diarias: somente a identidade assinada do JWT
// (sem fallback de matricula), revalidando o perfil no banco.
function requerAdministradorJwt(permitido, mensagem) {
  return async (req, res, next) => {
    const sessao = lerSessao(req);
    if (!sessao?.sub) {
      return res.status(401).json({
        error: 'Nao autenticado',
        message: 'Sessao ausente ou invalida. Faca login.',
      });
    }
    const usuario = await buscarUsuarioPorId(sessao.sub);
    if (!usuario || usuario.tipo !== 'ADMINISTRADOR' || !permitido(usuario)) {
      return res.status(403).json({ error: 'Sem permissao', message: mensagem });
    }
    req.atuante = usuario;
    next();
  };
}

// Etapa Transporte: setor Transporte ou nivel Master.
export const requerTransporteOuMaster = requerAdministradorJwt(
  (u) => u.nivel === 'MASTER' || u.setor === 'TRANSPORTE',
  'Apenas o Transporte ou ADM Master podem aprovar Partes Diárias em lote.',
);

// Etapa final: Gestao (Tecnico de Planejamento) ou nivel Master.
export const requerPlanejamentoOuMaster = requerAdministradorJwt(
  (u) => u.nivel === 'MASTER' || ehSetorGestao(u.setor),
  'Apenas a Gestão / Planejamento ou ADM Master podem aprovar Partes Diárias em lote.',
);

// Exclusão em massa de telemetria por placa: Master, Gestão ou Transporte (JWT, sem fallback).
export const requerMasterGestaoTransporte = requerAdministradorJwt(
  (u) => u.nivel === 'MASTER' || ehSetorGestao(u.setor) || u.setor === 'TRANSPORTE',
  'Apenas ADM Master, Gestão ou Transporte podem excluir a telemetria de uma placa.',
);

export function requerMaster(req, res, next) {
  if (!req.atuante || req.atuante.nivel !== 'MASTER') {
    return res.status(403).json({
      error: 'Sem permissao',
      message: 'Apenas ADM Master.',
    });
  }
  next();
}

// Autorizacao estrita da Matriz Calendario: usa exclusivamente a identidade
// do JWT (sem fallback de x-acting-matricula) e revalida o nivel no banco.
export async function requerMasterMatriz(req, res, next) {
  const sessao = lerSessao(req);
  if (!sessao?.sub) {
    return res.status(401).json({
      error: 'Nao autenticado',
      message: 'Sessao ausente ou invalida. Faca login.',
    });
  }
  const usuario = await buscarUsuarioPorId(sessao.sub);
  if (!usuario || usuario.tipo !== 'ADMINISTRADOR' || usuario.nivel !== 'MASTER') {
    return res.status(403).json({
      error: 'Sem permissao',
      message: 'Permissão negada. Apenas usuários MASTER podem alterar a matriz calendário.',
    });
  }
  req.atuante = usuario;
  next();
}
