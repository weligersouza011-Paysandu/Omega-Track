import { Router } from 'express';
import {
  listarVeiculosTerceiros,
  criarVeiculoTerceiro,
  atualizarVeiculoTerceiro,
  deletarVeiculoTerceiro,
} from '../controllers/veiculosTerceirosController.js';
import { requerAdminAutenticado } from '../middleware/sessao.js';
import { paramContrato } from '../middleware/escopo.js';
import prisma from '../config/database.js';
import { UUID } from '../utils/contrato.js';

// Veiculos de empresas terceirizadas (somente Programacao de Recursos).
const router = Router();

// Terceiro de outro contrato => 404 (Master enxerga todos).
router.param('id', paramContrato(async (id) => (UUID.test(id)
  ? (await prisma.veiculoTerceiro.findUnique({ where: { id }, select: { contrato: true } }))?.contrato
  : null)));
router.get('/', requerAdminAutenticado, listarVeiculosTerceiros);
router.post('/', requerAdminAutenticado, criarVeiculoTerceiro);
router.put('/:id', requerAdminAutenticado, atualizarVeiculoTerceiro);
router.delete('/:id', requerAdminAutenticado, deletarVeiculoTerceiro);

export default router;
