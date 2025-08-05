import * as WoT from 'wot-typescript-definitions';
import { ThingHandler, loadAllThings, loadConfiguredThings } from './ThingHandler.js';
import { WotLabConfig } from '../config/ThingConfig.js';
import { createLoggers } from '../utils/debug.js';

const { debug, info } = createLoggers('things');

export interface ThingCreationResult {
  thingId: string;
  title: string;
  success: boolean;
  error?: string;
}

export class ThingFactory {
  
  // eslint-disable-next-line no-unused-vars
  constructor(private wot: typeof WoT) {}

  async createThing(handler: ThingHandler): Promise<ThingCreationResult> {
    try {
      const exposedThing = await this.wot.produce(handler.thingDescription);
      await handler.setup(exposedThing);
      await exposedThing.expose();
      
      const thingId = handler.thingDescription.id ? 
        handler.thingDescription.id.replace('urn:wot:', '') : 
        (handler.thingDescription.title || 'unknown');
      debug(`✓ Thing '${handler.thingDescription.title}' exposed with ID: ${thingId}`);
      
      return {
        thingId,
        title: handler.thingDescription.title || 'Unknown',
        success: true
      };
    } catch (error) {
      const thingId = handler.thingDescription.id ? 
        handler.thingDescription.id.replace('urn:wot:', '') : 
        (handler.thingDescription.title || 'unknown');
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error(`❌ Failed to expose thing '${thingId}':`, errorMessage);
      
      return {
        thingId,
        title: handler.thingDescription.title || 'Unknown',
        success: false,
        error: errorMessage
      };
    }
  }

  async createThings(handlers: ThingHandler[]): Promise<ThingCreationResult[]> {
    const results: ThingCreationResult[] = [];
    
    for (const handler of handlers) {
      const result = await this.createThing(handler);
      results.push(result);
    }
    
    return results;
  }

  async createAllThings(): Promise<ThingCreationResult[]> {
    info('🔍 Auto-discovering all Things...');
    const handlers = await loadAllThings();
    return await this.createThings(handlers);
  }

  async createConfiguredThings(config: WotLabConfig): Promise<ThingCreationResult[]> {
    const handlers = await loadConfiguredThings(config);
    return await this.createThings(handlers);
  }
}