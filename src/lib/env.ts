import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — run "npm run setup"'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters — run "npm run setup"'),
  DATA_DIR: z.string().default('./data'),
  /** Where the dashboard runs (the automation Chrome opens its setup page there). */
  APP_URL: z.string().url().default('http://localhost:3000'),
  BROWSER_CHANNEL: z.enum(['chrome', 'msedge', 'chromium']).default('chrome'),
  BROWSER_EXECUTABLE_PATH: z.string().optional(),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function env(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
