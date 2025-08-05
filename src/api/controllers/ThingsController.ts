import { Request, Response } from 'express';
import { getGlobalState } from '../../globalState.js';
import { ApiResponseBuilder } from '../types/ApiResponse.js';

export class ThingsController {
  /**
   * Get list of tracked Things
   */
  static getTrackedThings(req: Request, res: Response): void {
    try {
      const globalState = getGlobalState();
      const things = Object.keys(globalState.things);
      res.json(ApiResponseBuilder.success({ count: things.length, things }));
    } catch (error) {
      res.status(500).json(ApiResponseBuilder.error('Failed to get tracked things', error));
    }
  }

  /**
   * Get all current states
   */
  static getAllStates(req: Request, res: Response): void {
    try {
      const globalState = getGlobalState();
      res.json(ApiResponseBuilder.success(globalState.things));
    } catch (error) {
      res.status(500).json(ApiResponseBuilder.error('Failed to get states', error));
    }
  }

  /**
   * Get current state of a specific thing
   */
  static getThingState(req: Request, res: Response): void {
    try {
      const { thingId } = req.params;
      const globalState = getGlobalState();
      const state = globalState.things[thingId];
      
      if (!state) {
        res.status(404).json({
          ...ApiResponseBuilder.notFound('Thing', thingId),
          data: { available: Object.keys(globalState.things) }
        });
        return;
      }
      
      res.json(ApiResponseBuilder.success(state));
    } catch (error) {
      res.status(500).json(ApiResponseBuilder.error('Failed to get state', error));
    }
  }
}
