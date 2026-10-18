import { Router } from 'express';
import { obterEficiencia } from '../controllers/eficienciaController.js';
import { requerAdmin } from '../middleware/sessao.js';

const router = Router();

// Dashboard de Eficiencia de Transporte (ADM/Transporte/Gestao/Master).
// GET /api/eficiencia?dataInicio=&dataFim=&tag=&modelo=&contrato=&situacao=MOB|DESMOB|TODOS
// Eficiencia = dias de Operacao / (Operacao + Corretiva + Indisponibilidade + Interdicao).
// Preventiva fica isenta do denominador; dias uteis sem lancamento contam como pendentes.
router.get('/', requerAdmin, obterEficiencia);

export default router;
