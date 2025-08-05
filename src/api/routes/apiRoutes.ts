import express from 'express';
import { ThingsController } from '../controllers/ThingsController.js';
import { StateCheckController } from '../controllers/StateCheckController.js';
import { SimulationController } from '../controllers/SimulationController.js';
import { ApiResponseBuilder } from '../types/ApiResponse.js';
import { getGlobalState } from '../../globalState.js';

export function createApiRoutes(
  thingEndpointRegistry: Map<string, Map<string, Function>>
): express.Router {
  const apiRouter = express.Router();
  const simulationController = new SimulationController(thingEndpointRegistry);

  // API documentation endpoint
  apiRouter.get('/', (req, res) => {
    const globalState = getGlobalState();
    const info = {
      name: 'WoT Lab Simulation API',
      version: '1.0.0',
      trackedThings: Object.keys(globalState.things),
      registeredSimulationEndpoints: Array.from(thingEndpointRegistry.keys()),
      endpoints: {
        // State Management
        'GET /tracked': 'Get list of tracked Things',
        'GET /states': 'Get all current states',
        'GET /states/:thingId': 'Get current state of a specific thing',
        'GET /check/:thingId/:property/:expectedValue': 'Check if a property has expected value',
        'POST /check/:thingId': 'Batch check multiple properties',
        
        // Thing Simulation
        'GET /things/:thingId/endpoints': 'Get available simulation endpoints for a thing',
        'ALL /things/:thingId/*': 'Thing-specific simulation endpoints (registered by each thing)'
      }
    };
    res.json(ApiResponseBuilder.success(info));
  });

  // State management routes
  apiRouter.get('/tracked', ThingsController.getTrackedThings);
  apiRouter.get('/states', ThingsController.getAllStates);
  apiRouter.get('/states/:thingId', ThingsController.getThingState);

  // State checking routes
  apiRouter.get('/check/:thingId/:property/:expectedValue', StateCheckController.checkProperty);
  apiRouter.post('/check/:thingId', StateCheckController.batchCheckProperties);

  // Simulation routes
  apiRouter.get('/things/:thingId/endpoints', simulationController.getThingEndpoints);

  // Dynamic routing for Thing simulation endpoints
  const thingRouter = express.Router({ mergeParams: true });
  thingRouter.all('/*path', simulationController.handleThingEndpoint);
  apiRouter.use('/things/:thingId', thingRouter);

  return apiRouter;
}
