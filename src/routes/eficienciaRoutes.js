import { Router } from 'express';
import multer from 'multer';
import { obterEficiencia, obterMatrizMensal, importarHistorico } from '../controllers/eficienciaController.js';
import { requerAdmin } from '../middleware/sessao.js';

const router = Router();
// Multer em memoria para XLSX (max 20 MB) — sem salvar em disco.
const uploadXlsx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Apenas arquivos .xlsx ou .xls sao aceitos.'), ok);
  },
});

// Dashboard de Eficiencia de Transporte (ADM/Transporte/Gestao/Master).
// GET /api/eficiencia?dataInicio=&dataFim=&tag=&modelo=&contrato=&situacao=MOB|DESMOB|TODOS
// Eficiencia = dias de Operacao / (Operacao + Corretiva + Indisponibilidade + Interdicao).
// Preventiva fica isenta do denominador; dias uteis sem lancamento contam como pendentes.
router.get('/', requerAdmin, obterEficiencia);

// Matriz Calendario — status dia a dia por veiculo no mes selecionado.
// GET /api/eficiencia/matriz?mes=YYYY-MM&tag=&modelo=&contrato=&situacao=
router.get('/matriz', requerAdmin, obterMatrizMensal);

// POST /api/eficiencia/importar-historico
// Importacao em lote do historico de Partes Diarias para o BI de Eficiencia.
// Multipart: campo `arquivo` (.xlsx). Requer autenticacao de ADM.
router.post('/importar-historico', requerAdmin, uploadXlsx.single('arquivo'), importarHistorico);

export default router;
