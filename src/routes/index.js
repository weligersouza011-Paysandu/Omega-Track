import { Router } from 'express';
import mobDesmobRoutes from './mobDesmobRoutes.js';
import documentacaoRoutes from './documentacaoRoutes.js';
import parteDiariaRoutes from './parteDiariaRoutes.js';
import uploadRoutes from './uploadRoutes.js';

const router = Router();

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
