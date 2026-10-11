import app from './app.js';
import config from './config/index.js';
import { testConnection } from './config/database.js';

async function startServer() {
  try {
    await testConnection();

    const server = app.listen(config.port, () => {
      console.log(`\n========================================`);
      console.log(`  OMEGATRACK API`);
      console.log(`  Ambiente: ${config.nodeEnv}`);
      console.log(`  Porta: ${config.port}`);
      console.log(`  Acesse: http://localhost:${config.port}`);
      console.log(`========================================\n`);
    });

    const gracefulShutdown = (signal) => {
      console.log(`\n[SHUTDOWN] Recebido sinal ${signal}. Encerrando servidor...`);
      server.close(async () => {
        console.log('[SHUTDOWN] Servidor HTTP encerrado.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
      console.error('[UNCAUGHT EXCEPTION]', err);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[UNHANDLED REJECTION]', reason);
      process.exit(1);
    });
  } catch (error) {
    console.error('[FATAL] Falha ao iniciar o servidor:', error);
    process.exit(1);
  }
}

startServer();
