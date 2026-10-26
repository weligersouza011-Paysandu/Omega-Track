import { Router } from 'express';
import multer from 'multer';
import {
  importarAbastecimentos,
  listarAbastecimentos,
  listarMeses,
} from '../controllers/abastecimentoController.js';
import { requerAdmin } from '../middleware/sessao.js';

const router = Router();

// Upload em memória: a planilha é lida e descartada, sem gravar em disco.
const uploadPlanilha = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const aceito = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    if (!aceito) {
      const erro = new Error('Apenas arquivos .xlsx, .xls ou .csv sao aceitos.');
      erro.statusCode = 400;
      return cb(erro);
    }
    return cb(null, true);
  },
});

function receberPlanilha(req, res, next) {
  uploadPlanilha.single('arquivo')(req, res, (erro) => {
    if (!erro) return next();
    if (erro instanceof multer.MulterError && erro.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'Arquivo muito grande',
        message: 'O limite para importacao de abastecimentos e 20 MB.',
      });
    }
    return res.status(400).json({
      error: 'Arquivo invalido',
      message: erro.message,
    });
  });
}

router.get('/', requerAdmin, listarAbastecimentos);
router.get('/meses', requerAdmin, listarMeses);
router.post('/importar', requerAdmin, receberPlanilha, importarAbastecimentos);

export default router;
