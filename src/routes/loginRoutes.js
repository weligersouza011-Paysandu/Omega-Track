// ============================================================================
// src/routes/loginRoutes.js — POST /api/login | POST /api/login/verificar |
// GET /api/login/eu | POST /api/login/senha (troca a propria senha, requer
// Bearer) | POST /api/login/assinatura (compatibilidade; prefira
// PUT /api/usuarios/minha-assinatura).
// ============================================================================
import { Router } from 'express';
import { login, verificarPerfil, eu, trocarSenha, salvarMinhaAssinatura } from '../controllers/authController.js';

const router = Router();

router.post('/', login);
router.post('/verificar', verificarPerfil);
router.get('/eu', ...eu);
router.post('/senha', ...trocarSenha);
router.post('/assinatura', ...salvarMinhaAssinatura);

export default router;
