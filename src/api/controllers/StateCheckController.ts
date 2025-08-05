import { Request, Response } from 'express';
import { getGlobalState } from '../../globalState.js';
import { ApiResponseBuilder } from '../types/ApiResponse.js';
import { parseValue, compareValues } from '../../utils/ValueComparator.js';

export class StateCheckController {
  /**
   * Helper to validate and get thing state as object
   */
  private static getThingStateAsObject(thingId: string): { success: true; state: Record<string, unknown> } | { success: false; error: unknown } {
    const globalState = getGlobalState();
    const thingState = globalState.things[thingId];
    
    if (!thingState) {
      return {
        success: false,
        error: {
          ...ApiResponseBuilder.notFound('Thing', thingId),
          data: { available: Object.keys(globalState.things) }
        }
      };
    }

    if (typeof thingState !== 'object' || thingState === null) {
      return {
        success: false,
        error: ApiResponseBuilder.error('Thing state is not a valid object')
      };
    }

    return { success: true, state: thingState as Record<string, unknown> };
  }

  /**
   * Check if a specific property has an expected value
   */
  static checkProperty(req: Request, res: Response): void {
    try {
      const { thingId, property, expectedValue } = req.params;
      const thingStateResult = StateCheckController.getThingStateAsObject(thingId);
      
      if (!thingStateResult.success) {
        res.status(404).json(thingStateResult.error);
        return;
      }

      const thingStateObj = thingStateResult.state;

      if (!(property in thingStateObj)) {
        res.status(404).json({
          ...ApiResponseBuilder.error(`Property '${property}' not found in thing '${thingId}'`),
          data: { available: Object.keys(thingStateObj) }
        });
        return;
      }

      const actualValue = thingStateObj[property];
      const parsedExpected = parseValue(actualValue, expectedValue);
      const matches = compareValues(actualValue, parsedExpected);

      const result = {
        thingId,
        property,
        actualValue,
        expectedValue: parsedExpected,
        matches,
        timestamp: new Date().toISOString()
      };
      
      res.json(ApiResponseBuilder.success(result));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Cannot convert') || errorMessage.includes('Invalid')) {
        res.status(400).json(ApiResponseBuilder.error(errorMessage, error));
      } else {
        res.status(500).json(ApiResponseBuilder.error('Failed to check property', error));
      }
    }
  }

  /**
   * Batch check multiple properties
   */
  static batchCheckProperties(req: Request, res: Response): void {
    try {
      const { thingId } = req.params;
      const checks = req.body;
      
      const thingStateResult = StateCheckController.getThingStateAsObject(thingId);
      
      if (!thingStateResult.success) {
        res.status(404).json(thingStateResult.error);
        return;
      }

      const thingStateObj = thingStateResult.state;

      if (!checks || typeof checks !== 'object') {
        res.status(400).json(ApiResponseBuilder.error('Request body must be an object with property-value pairs'));
        return;
      }

      const results: Record<string, unknown> = {};
      let allMatch = true;

      for (const [property, expectedValue] of Object.entries(checks)) {
        if (!(property in thingStateObj)) {
          results[property] = {
            error: `Property '${property}' not found`,
            available: Object.keys(thingStateObj)
          };
          allMatch = false;
          continue;
        }

        try {
          const actualValue = thingStateObj[property];
          const parsedExpected = parseValue(actualValue, expectedValue);
          const matches = compareValues(actualValue, parsedExpected);

          results[property] = {
            actualValue,
            expectedValue: parsedExpected,
            matches
          };
          
          if (!matches) {
            allMatch = false;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          results[property] = {
            error: `Invalid comparison: ${errorMessage}`
          };
          allMatch = false;
        }
      }

      const result = {
        thingId,
        results,
        allMatch,
        timestamp: new Date().toISOString()
      };
      
      res.json(ApiResponseBuilder.success(result));
    } catch (error) {
      res.status(500).json(ApiResponseBuilder.error('Failed to perform batch check', error));
    }
  }
}
