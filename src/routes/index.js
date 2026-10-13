import { Router } from 'express';
import mobDesmobRoutes from './mobDesmobRoutes.js';
import documentacaoRoutes from './documentacaoRoutes.js';
import parteDiariaRoutes from './parteDiariaRoutes.js';
import uploadRoutes from './uploadRoutes.js';

const router = Router();

// Documentacao da API (antes servida na raiz `/`; agora em `/api` para a
// raiz poder entregar a interface React em producao).
router.get('/', (req, res) => {
  res.json({
    name: 'OmegaTrack API',
    description: 'Sistema de gestao de transporte, frota e manutencoes',
    version: process.env.npm_package_version || '1.0.0',
    endpoints: {
      health: '/api/health',
      mob_desmob: '/api/mob-desmob',
      documentacao: '/api/documentacao-veiculos',
      documentacao_farol: '/api/documentacao-veiculos/farol',
      partes_diarias: '/api/partes-diarias',
      partes_pendentes: '/api/partes-diarias/pendentes (requer x-api-key)',
      upload: '/api/upload?pasta=mobilizacao|partes-diarias|documentos (campo `arquivo`)',
      upload_delete: 'DELETE /api/upload { public_id }',
      foto_veiculo: '/api/mob-desmob/:tag/foto (campo `arquivo` -> foto_veiculo)',
      anexo_documento: '/api/documentacao-veiculos/:id/anexo (campo `arquivo` -> anexo_url)',
      evidencia_parte: '/api/partes-diarias/:id/evidencia (campo `arquivo` -> evidencia_url)',
    },
  });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OmegaTrack API',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

router.use('/mob-desmob', mobDesmobRoutes);
router.use('/documentacao-veiculos', documentacaoRoutes);
router.use('/partes-diarias', parteDiariaRoutes);
router.use('/upload', uploadRoutes);

export default router;
