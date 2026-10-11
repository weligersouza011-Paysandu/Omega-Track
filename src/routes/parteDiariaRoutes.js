import { Router } from 'express';
import {
  listarPartesDiarias,
  buscarParteDiaria,
  criarParteDiaria,
  atualizarParteDiaria,
  deletarParteDiaria,
  listarPendentesAssinatura,
  assinarParteDiaria,
} from '../controllers/parteDiariaController.js';
import { authApiKey } from '../middleware/auth.js';

const router = Router();

router.get('/', listarPartesDiarias);
router.get('/pendentes', authApiKey, listarPendentesAssinatura);
router.get('/:id', buscarParteDiaria);
router.post('/', criarParteDiaria);
router.post('/:id/assinar', authApiKey, assinarParteDiaria);
router.put('/:id', atualizarParteDiaria);
router.delete('/:id', deletarParteDiaria);

export default router;
