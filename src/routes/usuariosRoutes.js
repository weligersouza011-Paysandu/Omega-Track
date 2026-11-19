// ============================================================================
// src/routes/usuariosRoutes.js — Gestao de Usuarios (admins + operacionais)
// Atuante via JWT. Ver regras no controller.
// ============================================================================
import { Router } from 'express';
import {
  listarUsuarios,
  resumoUsuariosPorContrato,
  criarAdmin,
  criarLoteOperacionais,
  criarUsuarioRapido,
  atualizarUsuario,
  obterMinhaAssinatura,
  salvarMinhaAssinatura,
  salvarAssinaturaUsuario,
  alterarNivel,
  excluirUsuario,
  listarLogsAtividade,
  listarLixeira,
  restaurarVeiculo,
  restaurarParteDiaria,
} from '../controllers/usuariosController.js';
import {
  requerAdmin, requerAdminAutenticado, requerGestaoTransporte, requerMaster, requerSessao,
} from '../middleware/sessao.js';
import { paramContrato } from '../middleware/escopo.js';
import prisma from '../config/database.js';
import { UUID } from '../utils/contrato.js';

const router = Router();

// Usuario de outro contrato => 404 (Master enxerga todos).
router.param('id', paramContrato(async (id) => (UUID.test(id)
  ? (await prisma.usuario.findUnique({ where: { id }, select: { contrato: true } }))?.contrato
  : null)));

router.get('/minha-assinatura', requerSessao, obterMinhaAssinatura);
router.put('/minha-assinatura', requerSessao, salvarMinhaAssinatura);
router.get('/', requerSessao, listarUsuarios);
router.get('/resumo-contratos', requerAdmin, resumoUsuariosPorContrato);
// Historico global de atividades (admin) e lixeira (somente Master).
router.get('/logs', requerAdmin, listarLogsAtividade);
router.get('/lixeira', requerAdmin, requerMaster, listarLixeira);
router.post('/lixeira/veiculos/:tag/restaurar', requerAdmin, requerMaster, restaurarVeiculo);
router.post('/lixeira/partes/:id/restaurar', requerAdmin, requerMaster, restaurarParteDiaria);
router.post('/admin', criarAdmin);
router.post('/lote', requerAdmin, criarLoteOperacionais);
// Cadastro rapido de Operador/Supervisor pela Programacao de Recursos.
router.post('/rapido', requerAdminAutenticado, requerGestaoTransporte, criarUsuarioRapido);
router.put('/:id', requerAdmin, atualizarUsuario);
router.post('/:id/assinatura', requerAdmin, salvarAssinaturaUsuario);
router.patch('/:id/nivel', requerAdmin, alterarNivel);
router.delete('/:id', requerAdmin, excluirUsuario);

export default router;
