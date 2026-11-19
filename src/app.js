import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from './config/index.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { cabecalhosDeSeguranca } from './middleware/seguranca.js';

const app = express();

// Atras do proxy do Render: req.ip passa a ser o IP real do cliente (limite de login).
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cabecalhosDeSeguranca);
// gzip nas respostas (JSON e os bundles do frontend: cerca de 70% menores).
app.use(compression());

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

// Health check / keep-alive leve para evitar spin down no Render
app.get('/ping', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'pong',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', routes);

if (hasFrontendBuild) {
  // 1. Ficheiros estaticos do frontend compilado. Assets com hash ficam 1 dia
  // em cache; o index.html nunca (senao o navegador prende o bundle antigo).
  app.use(express.static(frontendDist, {
    maxAge: '1d',
    immutable: true,
    setHeaders: (res, filePath) => {
      // index.html, Service Worker e manifest sempre revalidados: senão o
      // navegador prende o bundle antigo e o SW nunca recebe a nova versão.
      if (/(index\.html|sw\.js|registerSW\.js|workbox-[\w-]+\.js|manifest\.webmanifest)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
      // Arquivos de /assets tem o hash do conteudo no nome (o Vite troca o nome a cada
      // mudanca): podem ficar 1 ano no navegador sem revalidar.
      else if (filePath.split(path.sep).includes('assets') || filePath.split('/').includes('assets')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
