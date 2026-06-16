import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';

import {MelviewMitsubishiHomebridgePlatform} from '../platform';
import {Unit} from '../data';

export class OutdoorTemperatureService {
    private readonly service: Service;
    private readonly device: Unit;
    private lastTemperature?: number;

    constructor(
        private readonly platform: MelviewMitsubishiHomebridgePlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        this.device = accessory.context.device;
        this.lastTemperature = this.parseOutdoorTemperature();
        this.service = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
            this.accessory.addService(this.platform.Service.TemperatureSensor);
        this.service.setCharacteristic(
            this.platform.Characteristic.Name,
            `${this.device.room} Outdoor Temperature`,
        );

        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.getCurrentTemperature.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).props.minValue = -50;
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).props.maxValue = 70;
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).props.minStep = 0.5;

        this.service.getCharacteristic(this.platform.Characteristic.StatusFault)
            .onGet(this.getStatusFault.bind(this));
    }

    public getService(): Service {
        return this.service;
    }

    public async updateCharacteristics(): Promise<void> {
        const temperature = this.parseOutdoorTemperature();
        const c = this.platform.Characteristic;

        if (temperature === undefined) {
            this.service.updateCharacteristic(c.StatusFault, c.StatusFault.GENERAL_FAULT);
            return;
        }

        this.lastTemperature = temperature;
        this.service.updateCharacteristic(c.StatusFault, c.StatusFault.NO_FAULT);
        this.service.updateCharacteristic(c.CurrentTemperature, temperature);
    }

    private async getCurrentTemperature(): Promise<CharacteristicValue> {
        const temperature = this.parseOutdoorTemperature();
        if (temperature !== undefined) {
            this.lastTemperature = temperature;
            return temperature;
        }

        return this.lastTemperature ?? 0;
    }

    private async getStatusFault(): Promise<CharacteristicValue> {
        return this.parseOutdoorTemperature() === undefined ?
            this.platform.Characteristic.StatusFault.GENERAL_FAULT :
            this.platform.Characteristic.StatusFault.NO_FAULT;
    }

    // MELView occasionally reports placeholder values when no genuine outdoor
    // reading is available. Anything outside a plausible ambient range is treated
    // as a fault rather than shown as stale/garbage data.
    private static readonly PLAUSIBLE_MIN = -40;
    private static readonly PLAUSIBLE_MAX = 50;

    private parseOutdoorTemperature(): number | undefined {
        const temperature = Number.parseFloat(this.device.state?.outdoortemp ?? '');
        if (!Number.isFinite(temperature)) {
            return undefined;
        }
        if (temperature < OutdoorTemperatureService.PLAUSIBLE_MIN ||
            temperature > OutdoorTemperatureService.PLAUSIBLE_MAX) {
            return undefined;
        }

        return temperature;
    }
}
