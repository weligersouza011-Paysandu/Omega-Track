// ============================================================================
// src/controllers/authController.js — Login dinâmico por matrícula (JWT 12h).
// POST /api/login/verificar { matricula } -> { cadastrada, exigeSenha, nome, tipo }
// POST /api/login          { matricula, senha? } -> { token, usuario }
//   - OPERACIONAL autentica só com a matrícula (sem senha).
//   - ADMINISTRADOR exige matrícula + senha.
// GET  /api/login/eu     (Bearer admin) -> perfil da sessao
// POST /api/login/senha  (Bearer admin) { atual, nova } -> troca a propria senha
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { verificarSenha, hashSenha } from '../utils/senha.js';
import { assinarSessao, requerAdmin, requerSessao } from '../middleware/sessao.js';
import { respostaAssinatura, salvarAssinaturaPadrao } from '../services/assinaturaService.js';

function semSenha(u) {
  if (!u) return u;
  const { senha_hash, ...resto } = u;
  return resto;
}

export const login = asyncHandler(async (req, res) => {
  const { matricula, senha } = req.body || {};
  if (!matricula || !String(matricula).trim()) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Informe a matrícula.',
    });
  }
  const usuario = await prisma.usuario.findFirst({
    where: { matricula: String(matricula).trim() },
  });
  if (!usuario) {
    return res.status(404).json({
      error: 'Matricula nao encontrada',
      message: 'Matrícula não cadastrada no sistema.',
    });
  }
  // Perfil administrativo: exige matrícula + senha.
  if (usuario.tipo === 'ADMINISTRADOR') {
    if (!senha || !usuario.senha_hash || !verificarSenha(senha, usuario.senha_hash)) {
      return res.status(401).json({
        error: 'Credenciais invalidas',
        message: 'Matricula ou senha incorretos.',
      });
    }
  }
  // Perfil operacional: autentica diretamente só com a matrícula.
  const token = assinarSessao(usuario);
  res.json({ data: { token, usuario: semSenha(usuario) } });
});

// Etapa 1 do login dinâmico: informa se a matrícula existe e se exige senha.
// Retorna o mínimo necessário (sem nenhum dado sensível).
export const verificarPerfil = asyncHandler(async (req, res) => {
  const { matricula } = req.body || {};
  if (!matricula || !String(matricula).trim()) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Informe a matrícula.',
    });
  }
  const usuario = await prisma.usuario.findFirst({
    where: { matricula: String(matricula).trim() },
    select: { nome: true, tipo: true },
  });
  if (!usuario) {
    return res.status(404).json({
      error: 'Matricula nao encontrada',
      cadastrada: false,
      message: 'Matrícula não cadastrada no sistema.',
    });
  }
  res.json({
    data: {
      cadastrada: true,
      exigeSenha: usuario.tipo === 'ADMINISTRADOR',
      nome: String(usuario.nome || '').split(' ')[0] || 'usuário',
      tipo: usuario.tipo,
    },
  });
});

export const eu = [
  requerAdmin,
  asyncHandler(async (req, res) => {
    res.json({ data: semSenha(req.atuante) });
  }),
];

export const trocarSenha = [
  requerAdmin,
  asyncHandler(async (req, res) => {
    const { atual, nova } = req.body || {};
    if (!nova || String(nova).length < 4) {
      return res.status(400).json({ error: 'Senha invalida', message: 'Nova senha com minimo de 4 caracteres.' });
    }
    const completo = await prisma.usuario.findUnique({ where: { id: req.atuante.id } });
    if (!verificarSenha(atual, completo.senha_hash)) {
      return res.status(401).json({ error: 'Senha incorreta', message: 'A senha atual nao confere.' });
    }
    const atualizado = await prisma.usuario.update({
      where: { id: req.atuante.id },
      data: { senha_hash: hashSenha(nova) },
    });
    res.json({ data: semSenha(atualizado) });
  }),
];

export const salvarMinhaAssinatura = [
  requerSessao,
  asyncHandler(async (req, res) => {
    const atualizado = await salvarAssinaturaPadrao(req.atuante, req.body || {});
    res.json({
      data: {
        usuario: semSenha(atualizado),
        ...respostaAssinatura(atualizado),
      },
    });
  }),
];
