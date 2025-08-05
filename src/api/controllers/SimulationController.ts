import { Request, Response } from 'express';
import { getGlobalState } from '../../globalState.js';
import { ApiResponseBuilder } from '../types/ApiResponse.js';

export class SimulationController {
  private thingEndpointRegistry: Map<string, Map<string, Function>>;

  constructor(registry: Map<string, Map<string, Function>>) {
    this.thingEndpointRegistry = registry;
  }

  /**
   * Get available simulation endpoints for a thing
   */
  getThingEndpoints = (req: Request, res: Response): void => {
    try {
      const { thingId } = req.params;
      const globalState = getGlobalState();
      
      if (!globalState.things[thingId]) {
        res.status(404).json({
          ...ApiResponseBuilder.notFound('Thing', thingId),
          data: { available: Object.keys(globalState.things) }
        });
        return;
      }

      const thingHandlers = this.thingEndpointRegistry.get(thingId);
      const endpoints = thingHandlers ? Array.from(thingHandlers.keys()) : [];
      
      res.json(ApiResponseBuilder.success({
        thingId,
        availableEndpoints: endpoints,
        baseUrl: `/api/v1/things/${thingId}`
      }));
    } catch (error) {
      res.status(500).json(ApiResponseBuilder.error('Failed to get thing endpoints', error));
    }
  };

  /**
   * Handle dynamic thing simulation endpoints
   */
  handleThingEndpoint = (req: Request & { params: { thingId: string; path?: string } }, res: Response, next: Function): void => {
    const thingId = req.params.thingId;
    const path = req.params.path ? `/${req.params.path}` : '/';

    const globalState = getGlobalState();
    if (!globalState.things[thingId]) {
      res.status(404).json({
        ...ApiResponseBuilder.notFound('Thing', thingId),
        data: { available: Object.keys(globalState.things) }
      });
      return;
    }

    const thingHandlers = this.thingEndpointRegistry.get(thingId);
    if (!thingHandlers) {
      res.status(404).json(ApiResponseBuilder.error(
        `No simulation endpoints registered for thing '${thingId}'. Available things with endpoints: ${Array.from(this.thingEndpointRegistry.keys()).join(', ')}`
      ));
      return;
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
      res.status(404).json(ApiResponseBuilder.error(
        `Simulation endpoint '${req.method} ${path}' not found for thing '${thingId}'. Available endpoints: ${Array.from(thingHandlers.keys()).join(', ')}`
      ));
      return;
    }

    // Call the Thing's handler
    try {
      handler(req, res, next);
    } catch (error) {
      res.status(500).json(ApiResponseBuilder.error('Thing endpoint handler failed', error));
    }
  };

  /**
   * Simple pattern matching for routes with parameters
   */
  private matchRoute(pattern: string, path: string, req: Request): boolean {
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
        if (!req.params) {
          req.params = {};
        }
        req.params[paramName] = pathPart;
      } else if (patternPart !== pathPart) {
        return false;
      }
    }
    
    return true;
  }
}
