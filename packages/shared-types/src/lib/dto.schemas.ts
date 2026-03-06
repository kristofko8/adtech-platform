import { z } from 'zod';

// ============================================================
// DTO schémy pre API endpointy
// ============================================================

// Auth
export const LoginDtoSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const RefreshTokenDtoSchema = z.object({
  refreshToken: z.string(),
});

// Organizácia
export const CreateOrganizationDtoSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
});

// Ad Account
export const ConnectAdAccountDtoSchema = z.object({
  metaAccountId: z.string().regex(/^act_\d+$/),
  metaTokenId: z.string(),
});

// Automation Rule
export const CreateRuleDtoSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  type: z.enum(['BUDGET_PROTECTION', 'PERFORMANCE_DROP', 'CREATIVE_FATIGUE', 'SCALING_WINNER', 'CUSTOM']),
  conditions: z.array(z.object({
    metric: z.enum(['spend', 'roas', 'cpa', 'ctr', 'cpc', 'cpm', 'frequency', 'hook_rate', 'hold_rate']),
    operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq']),
    value: z.number(),
    window: z.enum(['1h', '6h', '12h', '24h', '48h', '72h', '7d', '14d', '30d']),
  })),
  actions: z.array(z.object({
    action: z.enum(['PAUSE_CAMPAIGN', 'PAUSE_ADSET', 'PAUSE_AD', 'INCREASE_BUDGET', 'DECREASE_BUDGET', 'UPDATE_BID', 'SEND_NOTIFICATION', 'MARK_CREATIVE_FATIGUED']),
    params: z.record(z.unknown()).optional(),
  })),
  cooldownMinutes: z.number().min(5).default(60),
  maxExecutionsPerDay: z.number().min(1).max(24).default(3),
});

// Pagination
export const PaginationDtoSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// Date range
export const DateRangeDtoSchema = z.object({
  dateFrom: z.string().datetime(),
  dateTo: z.string().datetime(),
});

// Typy odvodené zo schém
export type LoginDto = z.infer<typeof LoginDtoSchema>;
export type CreateOrganizationDto = z.infer<typeof CreateOrganizationDtoSchema>;
export type ConnectAdAccountDto = z.infer<typeof ConnectAdAccountDtoSchema>;
export type CreateRuleDto = z.infer<typeof CreateRuleDtoSchema>;
export type PaginationDto = z.infer<typeof PaginationDtoSchema>;
export type DateRangeDto = z.infer<typeof DateRangeDtoSchema>;
