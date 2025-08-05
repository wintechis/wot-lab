import { createLoggers } from '../utils/debug.js';

const { debug, info } = createLoggers('config');

export interface ThingInstanceConfig {
  /** Number of instances to create for this Thing type */
  instances: number;
  /** Optional custom ID prefix (defaults to Thing title) */
  idPrefix?: string;
}

export interface WotLabConfig {
  /** Configuration for each Thing type */
  things: Record<string, ThingInstanceConfig>;
  /** Global configuration options */
  global?: {
    /** Base port for WoT HTTP server */
    wotPort?: number;
    /** Port for State REST API */
    apiPort?: number;
  };
}

export class ConfigLoader {
  private static readonly DEFAULT_CONFIG_PATH = './wot-config.json';
  
  /**
   * Load configuration from file or return default "load all" config
   */
  static async loadConfig(configPath?: string): Promise<WotLabConfig | null> {
    const path = configPath || this.DEFAULT_CONFIG_PATH;
    
    try {
      const { readFile } = await import('fs/promises');
      const configContent = await readFile(path, 'utf-8');
      const config = JSON.parse(configContent) as WotLabConfig;
      
      debug(`✓ Loaded configuration from: ${path}`);
      debug(`✓ Thing types configured: ${Object.keys(config.things).join(', ')}`);
      
      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        info(`ℹ No config file found at ${path}, using auto-discovery mode`);
      } else {
        console.warn(`⚠ Failed to load config from ${path}:`, (error as Error).message);
      }
      return null;
    }
  }

  /**
   * Parse command line arguments for Thing configuration
   * Format: --things counter:3,lamp:2
   */
  static parseCliArgs(args: string[]): WotLabConfig | null {
    const thingsIndex = args.findIndex(arg => arg === '--things');
    if (thingsIndex === -1 || thingsIndex + 1 >= args.length) {
      return null;
    }

    const thingsArg = args[thingsIndex + 1];
    const things: Record<string, ThingInstanceConfig> = {};

    try {
      const thingSpecs = thingsArg.split(',');
      for (const spec of thingSpecs) {
        const [thingName, instanceCount] = spec.split(':');
        if (!thingName || !instanceCount) {
          throw new Error(`Invalid thing specification: ${spec}`);
        }

        const instances = parseInt(instanceCount, 10);
        if (isNaN(instances) || instances < 1) {
          throw new Error(`Invalid instance count for ${thingName}: ${instanceCount}`);
        }

        things[thingName.trim()] = { instances };
      }

      debug(`✓ Parsed CLI configuration: ${Object.entries(things).map(([name, config]) => `${name}:${config.instances}`).join(', ')}`);
      return { things };
    } catch (error) {
      console.error(`❌ Failed to parse CLI arguments:`, (error as Error).message);
      return null;
    }
  }

  /**
   * Get configuration from CLI args, config file, or return null for auto-discovery
   */
  static async getConfiguration(): Promise<WotLabConfig | null> {
    // Try CLI arguments first
    const cliConfig = this.parseCliArgs(process.argv);
    if (cliConfig) {
      return cliConfig;
    }

    // Try config file
    return await this.loadConfig();
  }
}
