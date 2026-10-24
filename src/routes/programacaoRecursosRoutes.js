import { Router } from 'express';
import {
  listarProgramacao,
  salvarProgramacao,
  removerProgramacao,
  copiarUltimaProgramacao,
  salvarProgramacaoEmLote,
} from '../controllers/programacaoRecursosController.js';
import { iniciarManutencao, registrarRetornoManutencao } from '../controllers/manutencaoRecursosController.js';
import { requerAdminAutenticado } from '../middleware/sessao.js';

function requerGestaoTransporte(req, res, next) {
  const usuario = req.atuante;
  if (usuario?.nivel !== 'MASTER' && !['GESTAO', 'TRANSPORTE'].includes(usuario?.setor)) {
    return res.status(403).json({
      error: 'Sem permissao',
      message: 'Apenas Gestao, Transporte ou ADM Master podem alterar a programacao.',
    });
  }
  next();
}

const router = Router();
router.get('/', requerAdminAutenticado, listarProgramacao);
router.post('/manutencoes', requerAdminAutenticado, requerGestaoTransporte, iniciarManutencao);
router.patch('/manutencoes/:id/retorno', requerAdminAutenticado, requerGestaoTransporte, registrarRetornoManutencao);
router.post('/copiar-ultima-programacao', requerAdminAutenticado, requerGestaoTransporte, copiarUltimaProgramacao);
router.put('/lote', requerAdminAutenticado, requerGestaoTransporte, salvarProgramacaoEmLote);
router.put('/:data/:tag', requerAdminAutenticado, requerGestaoTransporte, salvarProgramacao);
router.delete('/:data/:tag', requerAdminAutenticado, requerGestaoTransporte, removerProgramacao);

export default router;
