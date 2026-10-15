// ============================================================================
// src/middleware/sessao.js — Sessao JWT (login de administradores).
// Header: `Authorization: Bearer <token>` (12h). Fallback demo legado:
// `x-acting-matricula` (usado pela tela de Usuarios sem login real).
// ============================================================================
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import prisma from '../config/database.js';

export function assinarSessao(usuario) {
  return jwt.sign(
    { sub: usuario.id, matricula: usuario.matricula, nome: usuario.nome, tipo: usuario.tipo, setor: usuario.setor, nivel: usuario.nivel },
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

export function lerSessao(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7).trim(), config.loginSecret);
  } catch {
    return null;
  }
}

export async function atuanteDaRequisicao(req) {
  const sessao = lerSessao(req);
  if (sessao?.sub) {
    const u = await prisma.usuario.findUnique({ where: { id: sessao.sub } });
    if (u && u.tipo === 'ADMINISTRADOR') return u;
  }
  const mat = req.headers['x-acting-matricula'];
  if (!mat) return null;
  return prisma.usuario.findFirst({
    where: { matricula: String(mat), tipo: 'ADMINISTRADOR' },
  });
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

export function requerMaster(req, res, next) {
  if (!req.atuante || req.atuante.nivel !== 'MASTER') {
    return res.status(403).json({
      error: 'Sem permissao',
      message: 'Apenas ADM Master.',
    });
  }
  next();
}
