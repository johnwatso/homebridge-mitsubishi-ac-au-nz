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

        const pollingInterval = setInterval(() => {
          this.platform.melviewService?.getStatus(
            this.accessory.context.device.unitid)
            .then(s => {
              // this.platform.log.debug('Updating Accessory State:',
              //   this.accessory.context.device.unitid);
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
        }, 5000);
        this.platform.registerPollingInterval(pollingInterval);
    }

    private lastFaultKey?: string;

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
