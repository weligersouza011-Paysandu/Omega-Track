import { Router } from 'express';
import { bloquearMeioAmbiente } from '../middleware/setor.js';
import {
  listarProgramacao,
  salvarProgramacao,
  removerProgramacao,
  copiarUltimaProgramacao,
  salvarProgramacaoEmLote,
} from '../controllers/programacaoRecursosController.js';
import { iniciarManutencao, registrarRetornoManutencao } from '../controllers/manutencaoRecursosController.js';
import { requerAdminAutenticado, requerGestaoTransporte } from '../middleware/sessao.js';

const router = Router();
router.use(bloquearMeioAmbiente); // modulo de transporte
router.get('/', requerAdminAutenticado, listarProgramacao);
router.post('/manutencoes', requerAdminAutenticado, requerGestaoTransporte, iniciarManutencao);
router.patch('/manutencoes/:id/retorno', requerAdminAutenticado, requerGestaoTransporte, registrarRetornoManutencao);
router.post('/copiar-ultima-programacao', requerAdminAutenticado, requerGestaoTransporte, copiarUltimaProgramacao);
router.put('/lote', requerAdminAutenticado, requerGestaoTransporte, salvarProgramacaoEmLote);
router.put('/:data/:tag', requerAdminAutenticado, requerGestaoTransporte, salvarProgramacao);
router.delete('/:data/:tag', requerAdminAutenticado, requerGestaoTransporte, removerProgramacao);

export default router;
