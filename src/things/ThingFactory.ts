import * as WoT from 'wot-typescript-definitions';
import { ThingHandler } from './ThingHandler.js';
import { createLoggers } from '../utils/debug.js';

const { debug } = createLoggers('things');

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
      const td = handler.thingDescription;
      const instanceId = (td.id as string).replace('urn:wot:', '');

      // node-wot addresses a Thing by `slugify(title)`, not by its id
      // (binding-http's `expose`), and it bakes that path into every form it
      // generates. Exposing under the instance id as the title is what makes
      // the URL, the form hrefs and the Thing Description's own `id` agree —
      // /lamp-2 is the Thing whose id is urn:wot:lamp-2, always.
      const exposedThing = await this.wot.produce({ ...td, title: instanceId });
      await handler.setup(exposedThing);
      await exposedThing.expose();

      // The routing title has done its job once the paths are fixed. The Thing
      // Description is serialized from this object on every request, so putting
      // the human title back here means clients see "Motion Sensor" while the
      // Thing stays addressable as /motion.
      (exposedThing as unknown as { title: string }).title = td.title || instanceId;

      debug(`✓ Thing '${td.title}' exposed with ID: ${instanceId}`);

      return {
        thingId: instanceId,
        title: handler.thingDescription.title || 'Unknown',
        success: true
      };
    } catch (error) {
      const thingId = handler.thingDescription.id ? 
        handler.thingDescription.id.replace('urn:wot:', '') : 
        (handler.thingDescription.title || 'unknown');
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error(`ERROR: Failed to expose thing '${thingId}':`, errorMessage);
      
      return {
        thingId,
        title: handler.thingDescription.title || 'Unknown',
        success: false,
        error: errorMessage
      };
    }
  }

}
