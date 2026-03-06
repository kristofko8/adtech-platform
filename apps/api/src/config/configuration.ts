// Centrálna konfigurácia platformy
export const configuration = () => ({
  nodeEnv: process.env['NODE_ENV'] || 'development',
  port: parseInt(process.env['APP_PORT'] || '3000', 10),
  appSecret: process.env['APP_SECRET'] || 'dev-secret',

  database: {
    url: process.env['DATABASE_URL'] || '',
  },

  clickhouse: {
    host: process.env['CLICKHOUSE_HOST'] || 'http://localhost:8123',
    user: process.env['CLICKHOUSE_USER'] || 'adtech',
    password: process.env['CLICKHOUSE_PASSWORD'] || 'adtech_secret',
    database: process.env['CLICKHOUSE_DATABASE'] || 'analytics',
  },

  redis: {
    host: process.env['REDIS_HOST'] || 'localhost',
    port: parseInt(process.env['REDIS_PORT'] || '6379', 10),
    password: process.env['REDIS_PASSWORD'] || 'adtech_secret',
  },

  meta: {
    appId: process.env['META_APP_ID'] || '',
    appSecret: process.env['META_APP_SECRET'] || '',
    redirectUri: process.env['META_REDIRECT_URI'] || 'http://localhost:3000/auth/meta/callback',
    apiVersion: process.env['META_API_VERSION'] || 'v21.0',
    apiBaseUrl: process.env['META_API_BASE_URL'] || 'https://graph.facebook.com',
  },

  jwt: {
    secret: process.env['JWT_SECRET'] || 'dev-jwt-secret',
    expiresIn: process.env['JWT_EXPIRES_IN'] || '7d',
  },

  s3: {
    endpoint: process.env['S3_ENDPOINT'] || 'http://localhost:9002',
    accessKey: process.env['S3_ACCESS_KEY'] || 'adtech',
    secretKey: process.env['S3_SECRET_KEY'] || 'adtech_secret_minio',
    bucket: process.env['S3_BUCKET_CREATIVES'] || 'adtech-creatives',
    region: process.env['S3_REGION'] || 'eu-central-1',
  },

  slack: {
    webhookUrl: process.env['SLACK_WEBHOOK_URL'] || '',
  },

  frontendUrl: process.env['FRONTEND_URL'] || 'http://localhost:4200',
});

export type AppConfig = ReturnType<typeof configuration>;
