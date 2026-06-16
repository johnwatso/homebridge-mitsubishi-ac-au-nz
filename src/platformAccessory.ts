import {PlatformAccessory} from 'homebridge';

import {MelviewMitsubishiHomebridgePlatform} from './platform';
import {State, Unit} from './data';
import {HeatCoolService} from './services/heatCoolService';
import {DryService} from './services/dryService';
import {OutdoorTemperatureService} from './services/outdoorTemperatureService';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class MelviewMitsubishiPlatformAccessory {
    private dryService?: DryService;
    private outdoorTemperatureService?: OutdoorTemperatureService;
    private acService: HeatCoolService;
    constructor(
        private readonly platform: MelviewMitsubishiHomebridgePlatform,
        private readonly accessory: PlatformAccessory,
    ) {
      const device: Unit = accessory.context.device;
        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
          .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Mitsubishi Electric')
          .setCharacteristic(this.platform.Characteristic.Model, device.capabilities!.adaptortype)
          .setCharacteristic(this.platform.Characteristic.SerialNumber, device.unitid);

        /*********************************************************
         * HEATER & Cooler Capability
         * see https://developers.homebridge.io/#/service/HeaterCooler
         *********************************************************/
        this.acService = new HeatCoolService(this.platform, this.accessory);
        this.platform.log.info('HEAT/COOL Capability:', device.room, ' [COMPLETED]');

        /*********************************************************
         * Dehumidifier Capability
         * https://developers.homebridge.io/#/service/HumidifierDehumidifier
         *********************************************************/
        if (accessory.context.dry) {
          if (device.capabilities?.hasdrymode === 1) {
            this.dryService = new DryService(this.platform, this.accessory);
            this.acService.getService().addLinkedService(this.dryService.getService());
            this.platform.log.info('DRY Capability:', device.room, ' [COMPLETED]');
          } else {
            this.removeService(this.platform.Service.HumidifierDehumidifier);
            this.platform.log.info('DRY Capability:', device.room, ' [UNAVAILABLE]');
          }
        } else {
          this.removeService(this.platform.Service.HumidifierDehumidifier);
        }

        this.removeService(this.platform.Service.Fanv2);

        /*********************************************************
         * Energy reporting (groundwork only)
         * No native Apple Home HAP characteristic exists for AC energy yet;
         * iOS 26's energy features are EnergyKit (app-layer), not accessory
         * published. See docs/energy-reporting.md. Log capability for now.
         *********************************************************/
        if (device.capabilities?.hasenergy === 1) {
          this.platform.log.info('ENERGY Capability:', device.room,
            ' [REPORTED BY UNIT - native HomeKit support pending, see docs/energy-reporting.md]');
        }

        /*********************************************************
         * Outdoor Temperature Capability
         * https://developers.homebridge.io/#/service/TemperatureSensor
         *********************************************************/
        if (accessory.context.outdoorTemperature && this.hasOutdoorTemperature(device)) {
          this.outdoorTemperatureService = new OutdoorTemperatureService(this.platform, this.accessory);
          this.acService.getService().addLinkedService(this.outdoorTemperatureService.getService());
          this.platform.log.info('OUTDOOR TEMP Capability:', device.room, ' [COMPLETED]');
        } else {
          this.removeService(this.platform.Service.TemperatureSensor);
        }

        /*********************************************************
         * Polling for state change
         *********************************************************/
        this.startPolling();
    }

    private lastFaultKey?: string;

    // Polling defaults (seconds). The poll only catches *external* changes now
    // that commands self-refresh, so it can be relaxed; clamped to sane bounds.
    private static readonly DEFAULT_POLL_SECONDS = 10;
    private static readonly MIN_POLL_SECONDS = 5;
    private static readonly MAX_POLL_SECONDS = 120;

    private resolvePollIntervalMs(): number {
      const configured = Number(this.platform.config.pollInterval);
      const seconds = Number.isFinite(configured) && configured > 0 ?
        configured : MelviewMitsubishiPlatformAccessory.DEFAULT_POLL_SECONDS;
      const clamped = Math.min(
        Math.max(seconds, MelviewMitsubishiPlatformAccessory.MIN_POLL_SECONDS),
        MelviewMitsubishiPlatformAccessory.MAX_POLL_SECONDS,
      );
      return clamped * 1000;
    }

    private startPolling(): void {
      const intervalMs = this.resolvePollIntervalMs();
      // Stagger units with a random initial offset so they don't all hit MELView
      // on the same tick (avoids self-inflicted rate-limiting on multi-unit accounts).
      const jitterMs = Math.floor(Math.random() * intervalMs);
      const startTimeout = setTimeout(() => {
        this.pollOnce();
        const pollingInterval = setInterval(() => this.pollOnce(), intervalMs);
        this.platform.registerPollingInterval(pollingInterval);
      }, jitterMs);
      this.platform.registerPollingInterval(startTimeout);
    }

    private pollOnce(): void {
      this.platform.melviewService?.getStatus(
        this.accessory.context.device.unitid)
        .then(s => {
          this.accessory.context.device.state = s;
          this.reportFault(s);
          this.acService.updateCharacteristics().finally();
          this.dryService?.updateCharacteristics().finally();
          this.outdoorTemperatureService?.updateCharacteristics().finally();
        })
        .catch(e => {
          this.platform.log.error('Unable to find accessory status. Check the network');
          this.platform.log.debug(String(e));
        });
    }

    private hasOutdoorTemperature(device: Unit): boolean {
      return Number.isFinite(Number.parseFloat(device.state?.outdoortemp ?? ''));
    }

    /**
     * Surface MELView's fault/error reporting clearly in the logs, but only when
     * it changes, so a persistent fault doesn't spam every poll.
     */
    private reportFault(state: State): void {
      const fault = (state.fault ?? '').trim();
      const error = (state.error ?? '').trim();
      const hasFault = fault !== '' && fault.toUpperCase() !== 'NONE';
      const hasError = error !== '' && error.toLowerCase() !== 'ok';

      const key = hasFault || hasError ? `${fault}|${error}` : '';
      if (key === (this.lastFaultKey ?? '')) {
        return;
      }
      this.lastFaultKey = key;

      const room = this.accessory.context.device.room;
      if (key === '') {
        this.platform.log.info('Fault cleared:', room);
        return;
      }
      this.platform.log.warn(
        `MELView reported a fault for ${room} -`,
        hasFault ? `fault: ${fault}` : '',
        hasError ? `error: ${error}` : '',
      );
    }

    private removeService(serviceType: typeof this.platform.Service.HumidifierDehumidifier) {
      const service = this.accessory.getService(serviceType);
      if (service) {
        this.accessory.removeService(service);
      }
    }
}
