// ============================================================================
// src/controllers/usuariosController.js — Gestao de Usuarios (RBAC por setor)
// Tipos: ADMINISTRADOR (setor + nivel + senha) | OPERACIONAL (equipe de campo).
// Sem sessao real: o atuante vai no header `x-acting-matricula` (demo).
// Regras: promover/rebaixar/excluir-MASTER exigem atuante MASTER; demais
// operacoes exigem atuante admin. Banco vazio (bootstrap) libera o 1o cadastro.
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { hashSenha } from '../utils/senha.js';
import { atuanteDaRequisicao } from '../middleware/sessao.js';

const SETORES = ['MEIO_AMBIENTE', 'TRANSPORTE', 'GESTAO'];
const NIVEIS = ['MASTER', 'NORMAL'];

function semSenha(u) {
  if (!u) return u;
  const { senha_hash, ...resto } = u;
  return resto;
}

async function obterAtuante(req) {
  return atuanteDaRequisicao(req);
}

async function haAdministradores() {
  const n = await prisma.usuario.count({ where: { tipo: 'ADMINISTRADOR' } });
  return n > 0;
}

function normUpper(v) {
  return String(v || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function strOuNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export const listarUsuarios = asyncHandler(async (req, res) => {
  const { tipo } = req.query;
  const where = {};
  if (tipo === 'ADMINISTRADOR' || tipo === 'OPERACIONAL') where.tipo = tipo;
  const usuarios = await prisma.usuario.findMany({
    where,
    orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
  });
  res.json({ data: usuarios.map(semSenha) });
});

export const criarAdmin = asyncHandler(async (req, res) => {
  const { nome, matricula, contrato, funcao, setor, nivel, senha } = req.body || {};

  if (!nome || !String(nome).trim()) {
    return res.status(400).json({ error: 'Campos obrigatorios', message: 'Nome completo e obrigatorio.' });
  }
  if (!matricula || !String(matricula).trim()) {
    return res.status(400).json({ error: 'Campos obrigatorios', message: 'Matricula e obrigatoria.' });
  }
  const setorNorm = normUpper(setor);
  if (!SETORES.includes(setorNorm)) {
    return res.status(400).json({ error: 'Setor invalido', message: `Use um dos valores: ${SETORES.join(', ')}.` });
  }
  if (!senha || String(senha).length < 4) {
    return res.status(400).json({ error: 'Senha invalida', message: 'Senha de acesso com minimo de 4 caracteres.' });
  }
  const nivelNorm = normUpper(nivel || 'NORMAL');
  if (!NIVEIS.includes(nivelNorm)) {
    return res.status(400).json({ error: 'Nivel invalido', message: 'Use NORMAL ou MASTER.' });
  }

  const bootstrap = !(await haAdministradores());
  const atuante = await obterAtuante(req);
  if (!bootstrap && !atuante) {
    return res.status(403).json({ error: 'Sem permissao', message: 'Informe um administrador atuante (x-acting-matricula).' });
  }
  if (nivelNorm === 'MASTER' && !bootstrap && atuante.nivel !== 'MASTER') {
    return res.status(403).json({ error: 'Sem permissao', message: 'Apenas ADM Master pode criar outro Master.' });
  }

  const existente = await prisma.usuario.findUnique({ where: { matricula: String(matricula).trim() } });
  if (existente) {
    return res.status(409).json({ error: 'Conflito', message: 'Matricula ja cadastrada.' });
  }

  const criado = await prisma.usuario.create({
    data: {
      nome: String(nome).trim(),
      matricula: String(matricula).trim(),
      contrato: contrato ? String(contrato).trim() : null,
      funcao: strOuNull(funcao),
      tipo: 'ADMINISTRADOR',
      setor: setorNorm,
      nivel: nivelNorm,
      senha_hash: hashSenha(senha),
    },
  });
  res.status(201).json({ data: semSenha(criado) });
});

export const criarLoteOperacionais = asyncHandler(async (req, res) => {
  const atuante = await obterAtuante(req);
  if (!atuante) {
    return res.status(403).json({ error: 'Sem permissao', message: 'Informe um administrador atuante (x-acting-matricula).' });
  }
  const lista = req.body?.usuarios;
  if (!Array.isArray(lista) || lista.length === 0) {
    return res.status(400).json({ error: 'Lote vazio', message: 'Envie `usuarios: [{ matricula, nome, funcao? }]`.' });
  }
  if (lista.length > 500) {
    return res.status(400).json({ error: 'Lote grande', message: 'Maximo de 500 usuarios por lote.' });
  }

  const existentes = await prisma.usuario.findMany({
    where: { matricula: { in: lista.map((u) => String(u.matricula || '').trim()).filter(Boolean) } },
    select: { matricula: true },
  });
  const jaTem = new Set(existentes.map((u) => u.matricula));

  const paraCriar = [];
  const ignorados = [];
  lista.forEach((u, i) => {
    const matricula = String(u.matricula || '').trim();
    const nome = String(u.nome || '').trim();
    if (!matricula || !nome) return ignorados.push({ linha: i + 1, motivo: 'matricula/nome ausentes' });
    if (jaTem.has(matricula)) return ignorados.push({ linha: i + 1, matricula, motivo: 'ja cadastrada' });
    paraCriar.push({ matricula, nome, funcao: strOuNull(u.funcao), tipo: 'OPERACIONAL' });
  });

  let criados = 0;
  if (paraCriar.length > 0) {
    const r = await prisma.usuario.createMany({ data: paraCriar, skipDuplicates: true });
    criados = r.count;
  }
  res.status(201).json({ data: { criados, ignorados } });
});

export const atualizarUsuario = asyncHandler(async (req, res) => {
  const atuante = await obterAtuante(req);
  if (!atuante) {
    return res.status(403).json({ error: 'Sem permissao', message: 'Informe um administrador atuante (x-acting-matricula).' });
  }
  const { id } = req.params;
  const { nome, contrato, funcao, setor, senha, assinatura_url, assinatura_base64, remover_assinatura } = req.body || {};
  const data = {};
  if (nome !== undefined) data.nome = String(nome).trim();
  if (contrato !== undefined) data.contrato = contrato ? String(contrato).trim() : null;
  if (funcao !== undefined) data.funcao = strOuNull(funcao);
  if (setor !== undefined) {
    const s = normUpper(setor);
    if (!SETORES.includes(s)) {
      return res.status(400).json({ error: 'Setor invalido', message: `Use um dos valores: ${SETORES.join(', ')}.` });
    }
    data.setor = s;
  }
  if (senha !== undefined && senha !== null && senha !== '') {
    if (String(senha).length < 4) {
      return res.status(400).json({ error: 'Senha invalida', message: 'Minimo de 4 caracteres.' });
    }
    data.senha_hash = hashSenha(senha);
  }
  if (remover_assinatura) {
    data.assinatura_url = null;
  } else if (assinatura_base64) {
    const { uploadAssinaturaBase64 } = await import('../config/cloudinary.js');
    const u = await prisma.usuario.findUnique({ where: { id }, select: { matricula: true } });
    data.assinatura_url = await uploadAssinaturaBase64(assinatura_base64, u?.matricula || id);
  } else if (assinatura_url !== undefined) {
    if (assinatura_url) {
      const { validarUrlMidia } = await import('../config/cloudinary.js');
      validarUrlMidia(assinatura_url, 'assinatura_url');
    }
    data.assinatura_url = assinatura_url || null;
  }
  const atualizado = await prisma.usuario.update({ where: { id }, data });
  res.json({ data: semSenha(atualizado) });
});

export const salvarAssinaturaUsuario = asyncHandler(async (req, res) => {
  const atuante = await obterAtuante(req);
  if (!atuante) {
    return res.status(403).json({ error: 'Sem permissao', message: 'Informe um administrador atuante (x-acting-matricula).' });
  }
  const { id } = req.params;
  const { assinatura_base64, assinatura_url, remover } = req.body || {};
  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Usuario nao encontrado.' });
  }

  let urlFinal = assinatura_url;
  if (remover) {
    urlFinal = null;
  } else if (assinatura_base64) {
    const { uploadAssinaturaBase64 } = await import('../config/cloudinary.js');
    urlFinal = await uploadAssinaturaBase64(assinatura_base64, usuario.matricula);
  } else if (assinatura_url) {
    const { validarUrlMidia } = await import('../config/cloudinary.js');
    validarUrlMidia(assinatura_url, 'assinatura_url');
  } else {
    return res.status(400).json({ error: 'Dado ausente', message: 'Envie `assinatura_base64` ou `assinatura_url`.' });
  }

  const atualizado = await prisma.usuario.update({
    where: { id },
    data: { assinatura_url: urlFinal },
  });
  res.json({ data: semSenha(atualizado) });
});

export const alterarNivel = asyncHandler(async (req, res) => {
  const atuante = await obterAtuante(req);
  if (!atuante || atuante.nivel !== 'MASTER') {
    return res.status(403).json({ error: 'Sem permissao', message: 'Apenas ADM Master pode alterar niveis.' });
  }
  const nivelNorm = normUpper(req.body?.nivel);
  if (!NIVEIS.includes(nivelNorm)) {
    return res.status(400).json({ error: 'Nivel invalido', message: 'Use NORMAL ou MASTER.' });
  }
  const atualizado = await prisma.usuario.update({
    where: { id: req.params.id },
    data: { nivel: nivelNorm },
  });
  res.json({ data: semSenha(atualizado) });
});

export const excluirUsuario = asyncHandler(async (req, res) => {
  const atuante = await obterAtuante(req);
  if (!atuante) {
    return res.status(403).json({ error: 'Sem permissao', message: 'Informe um administrador atuante (x-acting-matricula).' });
  }
  const alvo = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!alvo) {
    return res.status(404).json({ error: 'Nao encontrado', message: 'Usuario nao encontrado.' });
  }
  if (alvo.tipo === 'ADMINISTRADOR' && alvo.nivel === 'MASTER' && atuante.nivel !== 'MASTER') {
    return res.status(403).json({ error: 'Sem permissao', message: 'Apenas ADM Master pode excluir uma conta Master.' });
  }
  await prisma.usuario.delete({ where: { id: alvo.id } });
  res.status(204).send();
});
