import { Router } from 'express';
import {
  listarVeiculosTerceiros,
  criarVeiculoTerceiro,
  atualizarVeiculoTerceiro,
  deletarVeiculoTerceiro,
} from '../controllers/veiculosTerceirosController.js';
import { requerAdminAutenticado } from '../middleware/sessao.js';

// Veiculos de empresas terceirizadas (somente Programacao de Recursos).
const router = Router();
router.get('/', requerAdminAutenticado, listarVeiculosTerceiros);
router.post('/', requerAdminAutenticado, criarVeiculoTerceiro);
router.put('/:id', requerAdminAutenticado, atualizarVeiculoTerceiro);
router.delete('/:id', requerAdminAutenticado, deletarVeiculoTerceiro);

export default router;
