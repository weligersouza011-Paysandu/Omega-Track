import config from '../config/index.js';

function authApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'Nao autorizado',
      message: 'Header x-api-key ausente.',
    });
  }

  if (apiKey !== config.apiKey) {
    return res.status(401).json({
      error: 'Nao autorizado',
      message: 'API Key invalida.',
    });
  }

  next();
}

export { authApiKey };
export default authApiKey;
