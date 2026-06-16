import {
  API,
  Categories,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings';
import {MelviewMitsubishiPlatformAccessory} from './platformAccessory';
import {MelviewService} from './melviewService';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class MelviewMitsubishiHomebridgePlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service;
    public readonly Characteristic: typeof Characteristic;
    public melviewService?: MelviewService;
    public accessories: PlatformAccessory[] = [];
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
        // run the method to discover / register your devices as accessories
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
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: PlatformAccessory) {
      this.log.info('Loading accessory from cache:', accessory.displayName);

      // add the restored accessory to the accessories cache so we can track if it has already been registered
      this.accessories.push(accessory);
    }

    registerPollingInterval(interval: NodeJS.Timeout) {
      this.pollingIntervals.add(interval);
    }

    /**
     * This is an example method showing how to register discovered accessories.
     * Accessories must only be registered once, previously created accessories
     * must not be registered again to prevent "duplicate UUID" errors.
     */
    async discoverDevices() {
      try {

        await this.melviewService!.login();
        const r = await this.melviewService!.discover();
        if (!r) {
          return;
        }
        const discoveredAccessoryUUIDs = new Set<string>();
        for (let j = 0; j < r.length; j++) {
          const b = r[j];
          this.log.info('Discovered Building [', b.buildingid, '] = \'', b.building,
            '\' with', b.units.length, 'units!');
          for (let i = 0; i < b.units.length; i++) {
            const device = b.units[i];

            const uuid = this.api.hap.uuid.generate(device.unitid);
            discoveredAccessoryUUIDs.add(uuid);
            this.log.debug('IDS:', device.unitid, uuid);
            const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

            if (existingAccessory) {
              // the accessory already exists
              this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

              const s = await this.melviewService!.getStatus(device.unitid);
              const c = await this.melviewService!.capabilities(device.unitid);
              existingAccessory.context.device = device;
              existingAccessory.context.dry = Boolean(this.config.dry);
              existingAccessory.context.device.capabilities = c;
              existingAccessory.context.device.state = s;
              new MelviewMitsubishiPlatformAccessory(this, existingAccessory);
            } else {
              // the accessory does not yet exist, so we need to create it
              this.log.info('Adding new accessory:', device.room, '[', device.unitid, ']:', uuid);

              const c = await this.melviewService!.capabilities(device.unitid);
              const s = await this.melviewService!.getStatus(device.unitid);

              device.capabilities = c;
              device.state = s;
              // create a new accessory
              //this.api.registerPlatformAccessories()
              const accessory = new this.api.platformAccessory(device.room, uuid, Categories.AIR_CONDITIONER);

              // store a copy of the device object in the `accessory.context`
              // the `context` property can be used to store any data about the accessory you may need
              accessory.context.device = device;
              accessory.context.dry = Boolean(this.config.dry);

              // create the accessory handler for the newly create accessory
              // this is imported from `platformAccessory.ts`
              new MelviewMitsubishiPlatformAccessory(this, accessory);

              // link the accessory to your platform
              this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
              this.accessories.push(accessory);
            }
          }
        }
        const staleAccessories = this.accessories.filter(
          accessory => !discoveredAccessoryUUIDs.has(accessory.UUID),
        );
        if (staleAccessories.length > 0) {
          for (const accessory of staleAccessories) {
            this.log.info('Removing accessory no longer discovered:', accessory.displayName);
          }
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
          this.accessories = this.accessories.filter(
            accessory => discoveredAccessoryUUIDs.has(accessory.UUID),
          );
        }
      } catch(e) {
        this.log.error('Failed to process platform discovery. Fix the problem and restart the service.');
        this.log.debug(String(e));
      }
    }
}
