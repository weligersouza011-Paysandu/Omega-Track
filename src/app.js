import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

app.get('/', (req, res) => {
  res.json({
    name: 'OmegaTrack API',
    description: 'Sistema de gestao de transporte, frota e manutencoes',
    version: '1.0.0',
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

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
