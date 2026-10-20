import { Router } from 'express';
import {
  listarPartesDiarias,
  buscarParteDiaria,
  buscarUltimaKm,
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
  apontamentoRapido,
} from '../controllers/parteDiariaController.js';
import { listarPendencias, ignorarPendencia, trocarOperadorPendencia } from '../controllers/pendenciasController.js';
import { authApiKey } from '../middleware/auth.js';
import { requerAdmin, requerMaster } from '../middleware/sessao.js';

const router = Router();

router.get('/', listarPartesDiarias);
router.get('/pendentes', authApiKey, listarPendentesAssinatura);
// Auditoria de pendencias de lancamento diario (antes de `/:id`).
// GET: admin ve tudo; operacional ve apenas as proprias.
// Periodo: ?datas=a,b | ?dataInicio=&dataFim= | ?dias=N | (padrao: dia util anterior).
router.get('/pendencias', listarPendencias);
// Troca manual do operador responsavel da pendencia (ADM/Transporte/Master).
router.patch('/pendencias/trocar-operador', requerAdmin, trocarOperadorPendencia);
// Descarte manual de pendencia (ADM/Transporte/Master):
//  - DELETE /pendencias/:tag/:data
//  - DELETE /pendencias/:id   (id = "TAG|YYYY-MM-DD", URL-encoded)
router.delete('/pendencias/:tag/:data', requerAdmin, ignorarPendencia);
router.delete('/pendencias/:id', requerAdmin, ignorarPendencia);
// Herança do odômetro (antes de `/:id` para não colidir com o parâmetro).
router.get('/ultima-km', buscarUltimaKm);
router.get('/:id/logs', listarLogs);
router.get('/:id', buscarParteDiaria);
router.post('/', criarParteDiaria);
// Upsert leve da Matriz Calendario do BI de Eficiencia (somente MASTER).
router.post('/apontamento-rapido', requerAdmin, requerMaster, apontamentoRapido);
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
