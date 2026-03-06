/**
 * Secrets Validator — spustí sa pred bootstrapom aplikácie
 *
 * V produkcii vyžaduje správne nastavenie všetkých kritických premenných.
 * Ak niektorá chýba alebo je príliš slabá, aplikácia sa nespustí.
 * To zabraňuje tichému pádu do nebezpečných defaultov.
 */

const MIN_SECRET_LENGTH = 32;

interface SecretRequirement {
  key: string;
  envVar: string;
  minLength?: number;
  required?: boolean; // true = povinná aj v dev
}

const PRODUCTION_SECRETS: SecretRequirement[] = [
  { key: 'APP_SECRET',      envVar: 'APP_SECRET',      minLength: MIN_SECRET_LENGTH, required: true },
  { key: 'JWT_SECRET',      envVar: 'JWT_SECRET',      minLength: MIN_SECRET_LENGTH, required: true },
  { key: 'META_APP_SECRET', envVar: 'META_APP_SECRET', minLength: 16,               required: true },
  { key: 'DATABASE_URL',    envVar: 'DATABASE_URL',    required: true },
  { key: 'REDIS_PASSWORD',  envVar: 'REDIS_PASSWORD',  minLength: 8 },
];

// Slabé/defaultné hodnoty, ktoré nesmú byť v produkcii
const KNOWN_WEAK_SECRETS = new Set([
  'dev-secret',
  'dev-jwt-secret',
  'adtech_secret',
  'adtech_secret_minio',
  'dev-secret-min-32-chars-long!!!!!',
  'changeme',
  'password',
  'secret',
]);

export function validateProductionSecrets(): void {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const errors: string[] = [];

  for (const req of PRODUCTION_SECRETS) {
    const value = process.env[req.envVar];

    // Povinná premenná musí byť nastavená vždy
    if (req.required && !isProduction) {
      if (!value) {
        console.warn(`[SecretsValidator] WARN: ${req.envVar} nie je nastavená (dev mode)`);
      }
      continue;
    }

    // V produkcii sú všetky kritické
    if (isProduction) {
      if (!value || value.trim() === '') {
        errors.push(`${req.envVar} nesmie byť prázdna v produkcii`);
        continue;
      }

      if (KNOWN_WEAK_SECRETS.has(value)) {
        errors.push(`${req.envVar} obsahuje defaultnú/slabú hodnotu "${value}" — použite silné tajomstvo`);
        continue;
      }

      if (req.minLength && value.length < req.minLength) {
        errors.push(`${req.envVar} musí mať aspoň ${req.minLength} znakov (má ${value.length})`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('\n🚨 [SecretsValidator] KRITICKÁ CHYBA — Aplikácia sa nespustí:\n');
    errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
    console.error('\nNastavte požadované premenné v .env súbore alebo v secrets manageri.\n');
    process.exit(1);
  }

  if (isProduction) {
    console.log('[SecretsValidator] ✓ Všetky production secrets sú správne nastavené');
  }
}
