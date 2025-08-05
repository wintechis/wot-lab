export interface ServerConfig {
  port: number;
  cors: {
    enabled: boolean;
    origins: string[];
  };
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  api: {
    version: string;
    prefix: string;
  };
}

export const defaultConfig: ServerConfig = {
  port: 3000,
  cors: {
    enabled: true,
    origins: ['*']
  },
  logging: {
    enabled: true,
    level: 'info'
  },
  api: {
    version: 'v1',
    prefix: '/api'
  }
};

export function getConfig(): ServerConfig {
  return {
    ...defaultConfig,
    port: parseInt(String(defaultConfig.port))
  };
}
