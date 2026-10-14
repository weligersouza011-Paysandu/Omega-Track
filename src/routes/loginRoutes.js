// ============================================================================
// src/routes/loginRoutes.js — POST /api/login | GET /api/login/eu |
// POST /api/login/senha (troca a propria senha, requer Bearer).
// ============================================================================
import { Router } from 'express';
import { login, eu, trocarSenha, salvarMinhaAssinatura } from '../controllers/authController.js';

const router = Router();

router.post('/', login);
router.get('/eu', ...eu);
router.post('/senha', ...trocarSenha);
router.post('/assinatura', ...salvarMinhaAssinatura);

export default router;
