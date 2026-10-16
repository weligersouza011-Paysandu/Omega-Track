import { Router } from 'express';
import { projecaoFrota } from '../controllers/manutencaoController.js';

const router = Router();

router.get('/projecao-frota', projecaoFrota);

export default router;
