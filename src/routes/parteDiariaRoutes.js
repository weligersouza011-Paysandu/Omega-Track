import { Router } from 'express';
import {
  listarPartesDiarias,
  buscarParteDiaria,
  criarParteDiaria,
  atualizarParteDiaria,
  deletarParteDiaria,
  listarPendentesAssinatura,
  assinarParteDiaria,
  anexarEvidencia,
  anexarFoto,
  assinarEtapa,
  removerAssinatura,
  listarLogs,
} from '../controllers/parteDiariaController.js';
import { authApiKey } from '../middleware/auth.js';

const router = Router();

router.get('/', listarPartesDiarias);
router.get('/pendentes', authApiKey, listarPendentesAssinatura);
router.get('/:id/logs', listarLogs);
router.get('/:id', buscarParteDiaria);
router.post('/', criarParteDiaria);
router.post('/:id/assinar', authApiKey, assinarParteDiaria);
// Fluxo de aprovacao em 3 etapas (formulario modelo Omega Service).
router.post('/:id/assinaturas', assinarEtapa);
router.delete('/:id/assinaturas/:etapa', removerAssinatura);
// Galeria de fotos do relatorio (upload integrado ao Cloudinary).
router.post('/:id/fotos', anexarFoto);
router.post('/:id/evidencia', anexarEvidencia);
router.put('/:id', atualizarParteDiaria);
router.delete('/:id', deletarParteDiaria);

export default router;
