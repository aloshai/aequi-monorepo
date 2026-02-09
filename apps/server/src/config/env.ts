import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // RPC URLs (comma-separated lists)
  RPC_URL_ETH: z.string().optional(),
  RPC_URL_ETH_FALLBACK: z.string().optional(),
  BSC_RPC_URL: z.string().optional(),
  BSC_RPC_URL_FALLBACK: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // CORS
  CORS_ORIGIN: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // DEX overrides
  UNISWAP_V2_FACTORY: z.string().optional(),
  UNISWAP_V2_ROUTER: z.string().optional(),

  // Executor
  AEQUI_EXECUTOR_ETH: z.string().optional(),
  AEQUI_EXECUTOR_BSC: z.string().optional(),
  EXECUTOR_INTERHOP_BUFFER_BPS: z.coerce.number().int().min(0).default(10),

  // Swap
  SWAP_QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(15),

  // Routing
  MAX_HOP_DEPTH: z.coerce.number().int().min(1).max(4).default(2),
  ENABLE_SPLIT_ROUTING: z.string().default('true'),
  MAX_SPLIT_LEGS: z.coerce.number().int().min(2).max(5).default(3),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  try {
    const env = envSchema.parse(process.env);

    const hasAnyRpc = env.RPC_URL_ETH || env.BSC_RPC_URL;
    if (!hasAnyRpc) {
      throw new Error(
        'At least one RPC URL must be configured (RPC_URL_ETH or BSC_RPC_URL)'
      );
    }

    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(
        (err) => `${err.path.join('.')}: ${err.message}`
      );
      throw new Error(
        `Environment validation failed:\n${errorMessages.join('\n')}`
      );
    }
    throw error;
  }
}

export function getEnv(): Env {
  return validateEnv();
}
