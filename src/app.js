import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from './config/index.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

const app = express();

// Pasta compilada do frontend (Vite -> frontend/dist). Em dev local ela pode
// nao existir (usa-se o `vite dev` na porta 5173); em producao (Render) o
// buildCommand gera essa pasta e o Express passa a servir a UI.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
const hasFrontendBuild = fs.existsSync(path.join(frontendDist, 'index.html'));

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
  // Em producao com build do frontend, a raiz serve a UI (index.html via
  // express.static abaixo). Sem build, mantem a documentacao JSON da API.
  if (hasFrontendBuild) {
    return res.sendFile(path.join(frontendDist, 'index.html'));
  }
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

if (hasFrontendBuild) {
  // Ficheiros estaticos do React (JS/CSS/assets com cache agressivo).
  app.use(express.static(frontendDist, { maxAge: '1d', index: false }));

  // Fallback SPA: qualquer rota fora de /api devolve o index.html para o
  // React Router resolver no cliente (ex: /frota, /executivo).
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
