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
  listarLogsAtividade,
  listarLixeira,
  restaurarVeiculo,
  restaurarParteDiaria,
} from '../controllers/usuariosController.js';
import { requerAdmin, requerMaster } from '../middleware/sessao.js';

const router = Router();

router.get('/', listarUsuarios);
// Historico global de atividades (admin) e lixeira (somente Master).
router.get('/logs', requerAdmin, listarLogsAtividade);
router.get('/lixeira', requerAdmin, requerMaster, listarLixeira);
router.post('/lixeira/veiculos/:tag/restaurar', requerAdmin, requerMaster, restaurarVeiculo);
router.post('/lixeira/partes/:id/restaurar', requerAdmin, requerMaster, restaurarParteDiaria);
router.post('/admin', criarAdmin);
router.post('/lote', criarLoteOperacionais);
router.put('/:id', atualizarUsuario);
router.post('/:id/assinatura', salvarAssinaturaUsuario);
router.patch('/:id/nivel', alterarNivel);
router.delete('/:id', excluirUsuario);

export default router;
