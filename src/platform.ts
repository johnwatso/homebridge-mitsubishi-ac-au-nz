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

    async discoverDevices() {
      if (!this.api.isMatterEnabled()) {
        this.log.error(
          'Matter is not enabled for this bridge. This plugin publishes Matter accessories, so it requires a',
          '"matter" block on the Homebridge bridge (or this plugin\'s child bridge). See the README for setup.',
        );
        return;
      }

      try {
        // Remove any HAP accessories left over from the pre-Matter version.
        this.removeStaleHapAccessories();

        await this.melviewService!.login();
        const r = await this.melviewService!.discover();
        if (!r) {
          return;
        }

        const discoveredUUIDs = new Set<string>();
        const toRegister: MatterAccessory[] = [];
        const toUpdate: MatterAccessory[] = [];

        for (const b of r) {
          this.log.info('Discovered Building [', b.buildingid, '] = \'', b.building,
            '\' with', b.units.length, 'units!');
          for (const device of b.units) {
            try {
              device.capabilities = await this.melviewService!.capabilities(device.unitid);
              device.state = await this.melviewService!.getStatus(device.unitid);

              const controller = new MelviewMatterAccessory(this, device);
              controller.uuids().forEach(uuid => discoveredUUIDs.add(uuid));

              for (const accessory of controller.buildAccessories()) {
                if (this.cachedMatterAccessories.some(a => a.UUID === accessory.UUID)) {
                  toUpdate.push(accessory);
                } else {
                  this.log.info('Adding new Matter accessory:', accessory.displayName, '[', accessory.UUID, ']');
                  toRegister.push(accessory);
                }
              }
              this.controllers.set(controller.acUuid, controller);
            } catch (e) {
              this.log.error('Failed to set up unit', device.room, '[', device.unitid, '] - skipping for now.');
              this.log.debug(String(e));
            }
          }
        }

        if (toRegister.length > 0) {
          await this.api.matter!.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRegister);
        }
        if (toUpdate.length > 0) {
          await this.api.matter!.updatePlatformAccessories(toUpdate);
        }

        // Start polling once accessories are registered.
        for (const controller of this.controllers.values()) {
          controller.startPolling();
        }

        await this.removeStaleMatterAccessories(discoveredUUIDs);
      } catch(e) {
        this.log.error('Failed to process platform discovery. Fix the problem and restart the service.');
        this.log.debug(String(e));
      }
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
