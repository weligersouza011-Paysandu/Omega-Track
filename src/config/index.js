import 'dotenv/config';

const config = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  apiKey: process.env.API_KEY || 'omegatrack-default-key',
  loginSecret: process.env.LOGIN_JWT_SECRET || process.env.API_KEY || 'omegatrack-dev-secret',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  farol: {
    diasAmarelo: 15,
  },
};

export default config;
