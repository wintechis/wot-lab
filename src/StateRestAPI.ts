import express from 'express';
import { Server } from 'http';
import { 
  corsMiddleware, 
  errorHandler, 
  notFoundHandler, 
  requestLogger 
} from './api/middleware.js';
import { getConfig, ServerConfig } from './api/ServerConfig.js';
import { createLoggers } from './utils/debug.js';
import { createApiRoutes } from './api/routes/apiRoutes.js';

const { debug, info } = createLoggers('http');

export class StateRestAPI {
  private app: express.Application;
  private server: Server | null = null;
  private config: ServerConfig;
  private thingEndpointRegistry = new Map<string, Map<string, Function>>();

  constructor(port?: number) {
    this.config = getConfig();
    if (port) {
      this.config.port = port;
    }
    
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Request parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // CORS
    if (this.config.cors.enabled) {
      this.app.use(corsMiddleware);
    }
    
    // Request logging
    if (this.config.logging.enabled) {
      this.app.use(requestLogger);
    }
  }

  private setupRoutes(): void {
    const apiRouter = createApiRoutes(this.thingEndpointRegistry);
    this.app.use(`${this.config.api.prefix}/${this.config.api.version}`, apiRouter);
  }

  private setupErrorHandling(): void {
    // 404 handler (must be after all routes)
    this.app.use(notFoundHandler);
    
    // Global error handler (must be last)
    this.app.use(errorHandler);
  }

  // Register a thing simulation endpoint
  public registerThingEndpoint(thingId: string, method: string, path: string, handler: Function): void {
    if (!this.thingEndpointRegistry.has(thingId)) {
      this.thingEndpointRegistry.set(thingId, new Map());
    }
    
    const thingHandlers = this.thingEndpointRegistry.get(thingId);
    if (thingHandlers) {
      thingHandlers.set(`${method}:${path}`, handler);
    }
    
    debug(`📡 Registered simulation endpoint: ${method} /api/v1/things/${thingId}${path}`);
  }

  public start(port?: number): Promise<void> {
    const serverPort = port || this.config.port;
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(serverPort, () => {
        resolve();
      });
      
      this.server.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          info('State Manager REST API stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Global instance for registering thing endpoints
let globalStateRestAPI: StateRestAPI | null = null;

export function getStateRestAPI(): StateRestAPI {
  if (!globalStateRestAPI) {
    globalStateRestAPI = new StateRestAPI();
  }
  return globalStateRestAPI;
}

export function setGlobalStateRestAPI(instance: StateRestAPI): void {
  globalStateRestAPI = instance;
}

export function registerThingEndpoint(thingId: string, method: string, path: string, handler: Function): void {
  const api = getStateRestAPI();
  api.registerThingEndpoint(thingId, method, path, handler);
}