import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  MatterAccessory,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings';
import {MelviewMatterAccessory} from './matterAccessory';
import {MelviewService} from './melviewService';

const DISCOVERY_RETRY_MIN_MS = 30 * 1000;
const DISCOVERY_RETRY_MAX_MS = 10 * 60 * 1000;

/** Backoff before retrying discovery: 30s, doubling to a 10 minute cap. Exported for testing. */
export function discoveryRetryDelayMs(attempt: number): number {
  return Math.min(DISCOVERY_RETRY_MIN_MS * 2 ** Math.max(attempt, 0), DISCOVERY_RETRY_MAX_MS);
}

/**
 * HomebridgePlatform
 *
 * This plugin exposes each Mitsubishi unit as a native Matter RoomAirConditioner
 * (plus an optional outdoor temperature sensor) via Homebridge 2.0's Matter API.
 * A `matter` block must be enabled on the bridge for the plugin to publish.
 */
export class MelviewMitsubishiHomebridgePlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service;
    public readonly Characteristic: typeof Characteristic;
    public melviewService?: MelviewService;
    // Matter accessories restored from cache (used to decide register vs update vs remove).
    private cachedMatterAccessories: MatterAccessory[] = [];
    // HAP accessories left over from the pre-Matter version; removed on launch.
    private staleHapAccessories: PlatformAccessory[] = [];
    private readonly controllers = new Map<string, MelviewMatterAccessory>();
    private readonly pollingIntervals = new Set<NodeJS.Timeout>();
    private discoveryAttempt = 0;

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
      this.Service = this.api.hap.Service;
      this.Characteristic = this.api.hap.Characteristic;
      this.log.debug('Finished initializing platform');

      if (!this.config.user || !this.config.password) {
        this.log.error('Plugin has not been configured. Please enter Melview user credentials.');
        return;
      }

      this.melviewService = new MelviewService(
        this.log,
        this.config,
        this.api);

      this.api.on('didFinishLaunching', () => {
        log.debug('Executed didFinishLaunching callback');
        this.discoverDevices().finally();
      });

      this.api.on('shutdown', () => {
        for (const interval of this.pollingIntervals) {
          clearInterval(interval);
        }
        this.pollingIntervals.clear();
      });
    }

    /**
     * Old HAP accessories from the pre-Matter version are restored here so they can
     * be removed during migration (the plugin no longer publishes via HAP).
     */
    configureAccessory(accessory: PlatformAccessory) {
      this.staleHapAccessories.push(accessory);
    }

    /** Matter equivalent of configureAccessory: track cached Matter accessories. */
    configureMatterAccessory(accessory: MatterAccessory) {
      this.log.info('Loading Matter accessory from cache:', accessory.displayName);
      this.cachedMatterAccessories.push(accessory);
    }

    registerPollingInterval(interval: NodeJS.Timeout) {
      this.pollingIntervals.add(interval);
    }

    async discoverDevices(): Promise<void> {
      if (!this.api.isMatterEnabled()) {
        this.log.error(
          'Matter is not enabled for this bridge. This plugin publishes Matter accessories, so it requires a',
          '"matter" block on the Homebridge bridge (or this plugin\'s child bridge). See the README for setup.',
        );
        return;
      }

      let complete = false;
      try {
        complete = await this.syncUnits();
      } catch (e) {
        this.log.error('MELView discovery failed:', e instanceof Error ? e.message : String(e));
        this.log.debug(String(e));
      }

      if (complete) {
        this.discoveryAttempt = 0;
        return;
      }
      // A bridge that boots before the internet is up (e.g. after a power cut) would
      // otherwise sit with unresponsive accessories until someone restarts it.
      const delayMs = discoveryRetryDelayMs(this.discoveryAttempt++);
      this.log.warn(`Retrying MELView discovery in ${Math.round(delayMs / 1000)}s.`);
      const retry = setTimeout(() => {
        this.pollingIntervals.delete(retry);
        this.discoverDevices().finally();
      }, delayMs);
      this.registerPollingInterval(retry);
    }

    /**
     * Set up every unit MELView lists that isn't already running. Returns false
     * when anything still needs another attempt, so the caller retries.
     */
    private async syncUnits(): Promise<boolean> {
      // Remove any HAP accessories left over from the pre-Matter version.
      this.removeStaleHapAccessories();

      // discover() authenticates on demand; no need to login separately here.
      const buildings = await this.melviewService!.discover();
      if (!buildings) {
        return false;
      }

      const listedUUIDs = new Set<string>();
      const toRegister: MatterAccessory[] = [];
      const started: MelviewMatterAccessory[] = [];
      let failed = 0;

      for (const b of buildings) {
        this.log.info('Discovered Building [', b.buildingid, '] = \'', b.building,
          '\' with', b.units.length, 'units!');
        for (const device of b.units) {
          const running = this.controllers.get(this.api.matter!.uuid.generate(device.unitid));
          if (running) {
            running.uuids().forEach(uuid => listedUUIDs.add(uuid));
            continue;
          }
          try {
            device.capabilities = await this.melviewService!.capabilities(device.unitid);
            device.state = await this.melviewService!.getStatus(device.unitid);

            const controller = new MelviewMatterAccessory(this, device);
            controller.uuids().forEach(uuid => listedUUIDs.add(uuid));

            for (const accessory of controller.buildAccessories()) {
              if (!this.cachedMatterAccessories.some(a => a.UUID === accessory.UUID)) {
                this.log.info('Adding new Matter accessory:', accessory.displayName, '[', accessory.UUID, ']');
              }
              toRegister.push(accessory);
            }
            started.push(controller);
          } catch (e) {
            failed++;
            // Keep the unit's accessories: a transient failure must not remove it
            // from Home along with its room, scenes and automations.
            listedUUIDs.add(this.api.matter!.uuid.generate(device.unitid));
            listedUUIDs.add(this.api.matter!.uuid.generate(device.unitid + '-outdoor'));
            this.log.error('Failed to set up unit', device.room, '[', device.unitid, '] - will retry:',
              e instanceof Error ? e.message : String(e));
            this.log.debug(String(e));
          }
        }
      }

      // Cached accessories are registered again too. Homebridge restores them
      // before going online with placeholder handlers; registering attaches the
      // real handlers to the restored endpoint, so Home keeps the same device.
      if (toRegister.length > 0) {
        await this.api.matter!.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRegister);
      }

      // Track controllers only once registered, so a failed registration is retried.
      for (const controller of started) {
        this.controllers.set(controller.acUuid, controller);
        controller.startPolling();
      }

      await this.removeStaleMatterAccessories(listedUUIDs);

      // An empty listing while we still hold cached accessories is treated as a
      // MELView hiccup rather than "no units".
      if (listedUUIDs.size === 0 && this.cachedMatterAccessories.length > 0) {
        return false;
      }
      return failed === 0;
    }

    private removeStaleHapAccessories() {
      if (this.staleHapAccessories.length === 0) {
        return;
      }
      this.log.info('Removing', this.staleHapAccessories.length,
        'legacy HAP accessory/accessories (migrated to Matter).');
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.staleHapAccessories);
      this.staleHapAccessories = [];
    }

    private async removeStaleMatterAccessories(discoveredUUIDs: Set<string>) {
      // Guard against a transient/empty MELView listing wiping still-valid accessories.
      if (discoveredUUIDs.size === 0) {
        this.log.warn(
          'MELView discovery returned no units; skipping stale-accessory removal to avoid',
          'unregistering valid accessories. Existing accessories left untouched.',
        );
        return;
      }

      const stale = this.cachedMatterAccessories.filter(a => !discoveredUUIDs.has(a.UUID));
      if (stale.length === 0) {
        return;
      }
      for (const accessory of stale) {
        this.log.info('Removing Matter accessory no longer discovered:', accessory.displayName);
      }
      await this.api.matter!.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      this.cachedMatterAccessories = this.cachedMatterAccessories.filter(a => discoveredUUIDs.has(a.UUID));
    }
}
