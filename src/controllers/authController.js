// ============================================================================
// src/controllers/authController.js — Login de administradores (JWT 12h).
// POST /api/login        { matricula, senha } -> { token, usuario }
// GET  /api/login/eu     (Bearer) -> perfil da sessao
// POST /api/login/senha  (Bearer) { atual, nova } -> troca a propria senha
// ============================================================================
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/error.js';
import { verificarSenha, hashSenha } from '../utils/senha.js';
import { assinarSessao, requerAdmin } from '../middleware/sessao.js';

function semSenha(u) {
  if (!u) return u;
  const { senha_hash, ...resto } = u;
  return resto;
}

export const login = asyncHandler(async (req, res) => {
  const { matricula, senha } = req.body || {};
  if (!matricula || !senha) {
    return res.status(400).json({
      error: 'Campos obrigatorios',
      message: 'Informe matricula e senha.',
    });
  }
  const usuario = await prisma.usuario.findFirst({
    where: { matricula: String(matricula).trim(), tipo: 'ADMINISTRADOR' },
  });
  if (!usuario || !usuario.senha_hash || !verificarSenha(senha, usuario.senha_hash)) {
    return res.status(401).json({
      error: 'Credenciais invalidas',
      message: 'Matricula ou senha incorretos.',
    });
  }
  const token = assinarSessao(usuario);
  res.json({ data: { token, usuario: semSenha(usuario) } });
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
  requerAdmin,
  asyncHandler(async (req, res) => {
    const { assinatura_base64, assinatura_url, remover } = req.body || {};
    let urlFinal = assinatura_url;

    if (remover) {
      urlFinal = null;
    } else if (assinatura_base64) {
      const { uploadAssinaturaBase64 } = await import('../config/cloudinary.js');
      urlFinal = await uploadAssinaturaBase64(assinatura_base64, req.atuante.matricula);
    } else if (assinatura_url) {
      const { validarUrlMidia } = await import('../config/cloudinary.js');
      validarUrlMidia(assinatura_url, 'assinatura_url');
    } else {
      return res.status(400).json({
        error: 'Dado ausente',
        message: 'Envie `assinatura_base64` ou `assinatura_url`.',
      });
    }

    const atualizado = await prisma.usuario.update({
      where: { id: req.atuante.id },
      data: { assinatura_url: urlFinal },
    });

    res.json({
      data: {
        usuario: semSenha(atualizado),
        assinatura_url: urlFinal,
      },
    });
  }),
];
