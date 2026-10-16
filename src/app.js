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
console.log(`[FRONTEND] build ${hasFrontendBuild ? 'ENCONTRADO' : 'NAO ENCONTRADO'} em ${frontendDist}`);

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

app.use('/api', routes);

if (hasFrontendBuild) {
  // 1. Ficheiros estaticos do frontend compilado. Assets com hash ficam 1 dia
  // em cache; o index.html nunca (senao o navegador prende o bundle antigo).
  app.use(express.static(frontendDist, {
    maxAge: '1d',
    immutable: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // 2. Fallback SPA: qualquer rota nao-API devolve o index.html do React
  // para o React Router resolver no cliente (ex: /frota, /executivo).
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
