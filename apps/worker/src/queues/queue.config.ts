import {
  QUEUE_ACCOUNT_DISCOVERY,
  QUEUE_INSIGHTS_SYNC,
  QUEUE_AUTOMATION_RULES,
  QUEUE_MEDIA_PROXY,
  QUEUE_CAPI_EVENTS,
} from '@adtech/shared-types';

export const QUEUE_NAMES = {
  ACCOUNT_DISCOVERY: QUEUE_ACCOUNT_DISCOVERY,
  INSIGHTS_SYNC: QUEUE_INSIGHTS_SYNC,
  AUTOMATION_RULES: QUEUE_AUTOMATION_RULES,
  MEDIA_PROXY: QUEUE_MEDIA_PROXY,
  CAPI_EVENTS: QUEUE_CAPI_EVENTS,
} as const;

// BullMQ konfigurácia pre každý typ frontu
export const defaultJobOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
  removeOnComplete: { count: 100 }, // Uchovať posledných 100 dokončených
  removeOnFail: { count: 200 },     // Uchovať posledných 200 chybových
};

export const criticalJobOptions = {
  ...defaultJobOptions,
  priority: 1,  // Najvyššia priorita
  attempts: 10,
};

export const lowPriorityJobOptions = {
  ...defaultJobOptions,
  priority: 10, // Nízka priorita
  attempts: 3,
};
