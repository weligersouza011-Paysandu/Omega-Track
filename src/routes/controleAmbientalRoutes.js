import { Router } from 'express';
import {
  obterPainelFumacaPreta,
  salvarMedicaoFumacaPreta,
} from '../controllers/controleAmbientalController.js';
import { requerAdmin } from '../middleware/sessao.js';

const router = Router();

const SETORES_ESCRITA_AMBIENTAL = ['GESTAO', 'MEIO_AMBIENTE'];

function requerEdicaoAmbiental(req, res, next) {
  const atuante = req.atuante;
  const liberado = atuante?.nivel === 'MASTER' || SETORES_ESCRITA_AMBIENTAL.includes(atuante?.setor);
  if (!liberado) {
    return res.status(403).json({
      error: 'Sem permissão',
      message: 'Apenas Gestão ou Meio Ambiente podem lançar medições de fumaça preta.',
    });
  }
  next();
}

router.get('/fumaca-preta', requerAdmin, obterPainelFumacaPreta);
router.post('/fumaca-preta', requerAdmin, requerEdicaoAmbiental, salvarMedicaoFumacaPreta);

export default router;
