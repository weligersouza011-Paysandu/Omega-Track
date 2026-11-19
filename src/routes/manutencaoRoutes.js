import { Router } from 'express';
import { bloquearMeioAmbiente } from '../middleware/setor.js';
import { requerSessao } from '../middleware/sessao.js';
import { projecaoFrota } from '../controllers/manutencaoController.js';

const router = Router();
router.use(bloquearMeioAmbiente); // modulo de transporte

router.get('/projecao-frota', requerSessao, projecaoFrota);

export default router;
