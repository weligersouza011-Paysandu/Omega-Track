// ============================================================================
// src/routes/loginRoutes.js — POST /api/login | POST /api/login/verificar |
// GET /api/login/eu | POST /api/login/senha (troca a propria senha, requer
// Bearer) | POST /api/login/assinatura (compatibilidade; prefira
// PUT /api/usuarios/minha-assinatura).
// ============================================================================
import { Router } from 'express';
import { limitarTentativasDeLogin } from '../middleware/seguranca.js';
import { login, verificarPerfil, eu, trocarSenha, salvarMinhaAssinatura } from '../controllers/authController.js';

const router = Router();

// Limite de tentativas por IP e por matricula (operacional entra so com a matricula).
router.post('/', limitarTentativasDeLogin, login);
router.post('/verificar', limitarTentativasDeLogin, verificarPerfil);
router.get('/eu', ...eu);
router.post('/senha', ...trocarSenha);
router.post('/assinatura', ...salvarMinhaAssinatura);

export default router;
