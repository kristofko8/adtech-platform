import { createClient, ClickHouseClient } from '@clickhouse/client';

export interface ClickHouseConfig {
  host: string;
  username: string;
  password: string;
  database: string;
}

// Singleton ClickHouse klient
let clickhouseInstance: ClickHouseClient | null = null;

export function getClickHouseClient(config?: ClickHouseConfig): ClickHouseClient {
  if (clickhouseInstance) return clickhouseInstance;

  clickhouseInstance = createClient({
    host: config?.host || process.env['CLICKHOUSE_HOST'] || 'http://localhost:8123',
    username: config?.username || process.env['CLICKHOUSE_USER'] || 'adtech',
    password: config?.password || process.env['CLICKHOUSE_PASSWORD'] || 'adtech_secret',
    database: config?.database || process.env['CLICKHOUSE_DATABASE'] || 'analytics',
    request_timeout: 30000,
    compression: {
      response: true,
      request: false,
    },
    clickhouse_settings: {
      // Povolenie asynchronných inserts pre batch operácie
      async_insert: 1,
      wait_for_async_insert: 0,
      // Optimalizácia pre analytické dotazy
      max_execution_time: 60,
    },
  });

  return clickhouseInstance;
}

export async function closeClickHouseClient() {
  if (clickhouseInstance) {
    await clickhouseInstance.close();
    clickhouseInstance = null;
  }
}
