// ============================================================================
// src/routes/usuariosRoutes.js — Gestao de Usuarios (admins + operacionais)
// Atuante via header `x-acting-matricula` (demo). Ver regras no controller.
// ============================================================================
import { Router } from 'express';
import {
  listarUsuarios,
  criarAdmin,
  criarLoteOperacionais,
  atualizarUsuario,
  salvarAssinaturaUsuario,
  alterarNivel,
  excluirUsuario,
} from '../controllers/usuariosController.js';

const router = Router();

router.get('/', listarUsuarios);
router.post('/admin', criarAdmin);
router.post('/lote', criarLoteOperacionais);
router.put('/:id', atualizarUsuario);
router.post('/:id/assinatura', salvarAssinaturaUsuario);
router.patch('/:id/nivel', alterarNivel);
router.delete('/:id', excluirUsuario);

export default router;
