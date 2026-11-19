import { Router } from 'express';
import { bloquearMeioAmbiente } from '../middleware/setor.js';
import {
  listarPartesDiarias,
  buscarParteDiaria,
  buscarUltimaKm,
  buscarObraProgramada,
  resumoAderencia,
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
  aprovarLoteTransporte,
  aprovarLotePlanejamento,
} from '../controllers/parteDiariaController.js';
import { listarPendencias, ignorarPendencia, trocarOperadorPendencia } from '../controllers/pendenciasController.js';
import { buscarRelatoriosPdfLote } from '../controllers/relatoriosPdfController.js';
import { authApiKey } from '../middleware/auth.js';
import { paramContrato } from '../middleware/escopo.js';
import prisma from '../config/database.js';
import { UUID } from '../utils/contrato.js';
import { requerAdmin, requerMaster, requerMasterMatriz, requerSessao, requerPlanejamentoOuMaster, requerTransporteOuMaster } from '../middleware/sessao.js';

const router = Router();
router.use(bloquearMeioAmbiente); // modulo de transporte

// Parte Diaria de outro contrato => 404 (Master enxerga todas). As rotas por
// chave de API (/pendentes, /:id/assinar) nao tem usuario e seguem globais.
router.param('id', paramContrato(async (id) => (UUID.test(id)
  ? (await prisma.parteDiaria.findUnique({ where: { id }, select: { contrato: true } }))?.contrato
  : null)));

router.get('/', requerSessao, listarPartesDiarias);
router.post('/exportacao/lote', requerSessao, buscarRelatoriosPdfLote);
router.get('/pendentes', authApiKey, listarPendentesAssinatura);
// Auditoria de pendencias de lancamento diario (antes de `/:id`).
// GET: admin ve tudo; operacional ve apenas as proprias.
// Periodo: ?datas=a,b | ?dataInicio=&dataFim= | ?dias=N | (padrao: dia util anterior).
router.get('/pendencias', requerSessao, listarPendencias);
// Troca manual do operador responsavel da pendencia (ADM/Transporte/Master).
router.patch('/pendencias/trocar-operador', requerAdmin, trocarOperadorPendencia);
// Descarte manual de pendencia (ADM/Transporte/Master):
//  - DELETE /pendencias/:tag/:data
//  - DELETE /pendencias/:id   (id = "TAG|YYYY-MM-DD", URL-encoded)
router.delete('/pendencias/:tag/:data', requerAdmin, ignorarPendencia);
router.delete('/pendencias/:id', requerAdmin, ignorarPendencia);
// Herança do odômetro (antes de `/:id` para não colidir com o parâmetro).
router.get('/ultima-km', requerSessao, buscarUltimaKm);
// Aderencia a Programacao (antes de `/:id`).
router.get('/obra-programada', requerSessao, buscarObraProgramada);
router.get('/aderencia', requerAdmin, resumoAderencia);
router.get('/:id/logs', requerSessao, listarLogs);
router.get('/:id', requerSessao, buscarParteDiaria);
router.post('/', requerSessao, criarParteDiaria);
// Upsert leve da Matriz Calendario do BI de Eficiencia (somente MASTER).
router.post('/apontamento-rapido', requerMasterMatriz, apontamentoRapido);
// Aprovacao em lote (etapa TRANSPORTE) — Transporte ou ADM Master.
router.post('/aprovar-lote-transporte', requerTransporteOuMaster, aprovarLoteTransporte);
// Aprovacao final em lote (etapa PLANEJADOR, sem desvio) — Gestao/Planejamento ou Master.
router.post('/aprovar-lote-planejamento', requerPlanejamentoOuMaster, aprovarLotePlanejamento);
router.post('/:id/assinar', authApiKey, assinarParteDiaria);
// Fluxo de aprovacao em 3 etapas (formulario modelo Omega Service).
router.post('/:id/assinaturas', requerSessao, assinarEtapa);
router.delete('/:id/assinaturas/:etapa', requerSessao, removerAssinatura);
// Galeria de fotos do relatorio (upload integrado ao Cloudinary).
router.post('/:id/fotos', requerSessao, anexarFoto);
router.post('/:id/evidencia', requerSessao, anexarEvidencia);
router.put('/:id', requerSessao, atualizarParteDiaria);
router.delete('/:id', requerAdmin, requerMaster, deletarParteDiaria);

export default router;
