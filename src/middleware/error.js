import config from '../config/index.js';

function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: 'Nao encontrado',
    message: `Rota ${req.method} ${req.originalUrl} nao existe.`,
  });
}

function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err);

  if (err.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      const target = err.meta?.target || [];
      return res.status(400).json({
        error: 'Conflito de dados',
        message: `Violacao de restricao unica nos campos: ${target.join(', ')}`,
      });
    }
    if (err.code === 'P2003') {
      const campo = err.meta?.field_name || err.meta?.constraint || '';
      return res.status(400).json({
        error: 'Referencia invalida',
        message: `Chave estrangeira invalida${campo ? ` (${campo})` : ''}. Verifique TAG do veículo, obra e demais campos relacionados.`,
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        error: 'Registro nao encontrado',
        message: 'O registro solicitado nao foi encontrado.',
      });
    }
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Erro de validacao',
      message: err.message,
      details: err.details || null,
    });
  }

  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 ? 'Erro interno no servidor.' : err.message;

  res.status(statusCode).json({
    error: statusCode === 500 ? 'Erro interno no servidor' : (err.error || 'Erro interno'),
    message,
    // Em desenvolvimento, expõe a mensagem exata do PostgreSQL/Neon + stack
    ...(config.nodeEnv === 'development' && statusCode === 500 && { details: err.message, stack: err.stack }),
    ...(config.nodeEnv === 'development' && statusCode !== 500 && { stack: err.stack }),
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export { notFoundHandler, errorHandler, asyncHandler };
