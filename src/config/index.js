import 'dotenv/config';

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  apiKey: process.env.API_KEY || 'omegatrack-default-key',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  farol: {
    diasAmarelo: 15,
  },
};

export default config;
