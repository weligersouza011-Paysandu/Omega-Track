import { Router } from 'express';
import { requerSessao } from '../middleware/sessao.js';
import { projecaoFrota } from '../controllers/manutencaoController.js';

const router = Router();

router.get('/projecao-frota', requerSessao, projecaoFrota);

export default router;
