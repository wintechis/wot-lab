// Centralized HTTP server for Thing endpoints
import express from 'express';
import { Server } from 'http';
import { createLoggers } from '../utils/debug.js';

const { debug, info } = createLoggers('http');

export class ThingHttpServer {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;
  private endpointRegistry = new Map();

  constructor(port = 4000) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });
  }

  private setupRoutes() {
    // Root endpoint - list all registered Things
    this.app.get('/', (req, res) => {
      const things = Array.from(this.endpointRegistry.keys());
      res.json({
        message: 'WoT Lab Thing HTTP Server',
        registeredThings: things,
        endpoints: things.map(thingId => `/${thingId}/*`)
      });
    });

    // Dynamic routing for Thing endpoints using express.Router
    const thingRouter = express.Router({ mergeParams: true });
    
    thingRouter.all('/*path', (req: express.Request & { params: { thingId: string; path?: string } }, res, next) => {
      const thingId = req.params.thingId;
      const path = req.params.path || req.path;

      const thingHandlers = this.endpointRegistry.get(thingId);
      if (!thingHandlers) {
        return res.status(404).json({
          error: `Thing '${thingId}' not found`,
          availableThings: Array.from(this.endpointRegistry.keys())
        });
      }

      // Try exact match first
      let handler = thingHandlers.get(`${req.method}:${path}`);
      
      // If no exact match, try pattern matching for parametric routes
      if (!handler) {
        for (const [key, h] of thingHandlers.entries()) {
          const [method, pattern] = key.split(':', 2);
          if (method === req.method && this.matchRoute(pattern, path, req)) {
            handler = h;
            break;
          }
        }
      }

      if (!handler) {
        return res.status(404).json({
          error: `Endpoint '${req.method} ${path}' not found for thing '${thingId}'`,
          availableEndpoints: Array.from(thingHandlers.keys())
        });
      }

      // Call the Thing's handler
      handler(req, res, next);
    });

    this.app.use('/:thingId', thingRouter);
  }

  // Simple pattern matching for routes with parameters
  private matchRoute(pattern: string, path: string, req: express.Request): boolean {
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    
    if (patternParts.length !== pathParts.length) {
      return false;
    }
    
    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];
      
      if (patternPart.startsWith(':')) {
        // Parameter - extract and add to req.params
        const paramName = patternPart.substring(1);
        if (!req.params) {req.params = {};}
        req.params[paramName] = pathPart;
      } else if (patternPart !== pathPart) {
        return false;
      }
    }
    
    return true;
  }

  registerThingEndpoint(thingId: string, method: string, path: string, handler: Function) {
    if (!this.endpointRegistry.has(thingId)) {
      this.endpointRegistry.set(thingId, new Map());
    }
    
    const thingHandlers = this.endpointRegistry.get(thingId);
    thingHandlers.set(`${method}:${path}`, handler);
    
    debug(`📡 Registered: ${method} /${thingId}${path}`);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        info(`🌐 Thing HTTP Server listening on port ${this.port}`);
        info(`   Visit http://localhost:${this.port}/ for available endpoints`);
        resolve();
      });
      
      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          info('🛑 Thing HTTP Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Global instance
let thingHttpServer: ThingHttpServer | null = null;

export function getThingHttpServer(): ThingHttpServer {
  if (!thingHttpServer) {
    thingHttpServer = new ThingHttpServer();
  }
  return thingHttpServer;
}

export function registerThingEndpoint(thingId: string, method: string, path: string, handler: Function) {
  const server = getThingHttpServer();
  server.registerThingEndpoint(thingId, method, path, handler);
}
