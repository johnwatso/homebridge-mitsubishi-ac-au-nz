import {MelviewMitsubishiHomebridgePlatform} from '../platform';
import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {WorkMode} from '../data';
import {AbstractService} from './abstractService';
import {
    CommandPower,
    CommandRotationSpeed,
    CommandSwingMode,
    CommandTargetHeaterCoolerState,
    CommandTemperature,
} from '../melviewCommand';

export class HeatCoolService extends AbstractService {
    constructor(
        protected readonly platform: MelviewMitsubishiHomebridgePlatform,
        protected readonly accessory: PlatformAccessory,
    ) {
        super(platform, accessory);

        this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .onGet(this.getCurrentHeaterCoolerState.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
            .onSet(this.setTargetHeaterCoolerState.bind(this))
            .onGet(this.getTargetHeaterCoolerState.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).props.validValues =
            this.getSupportedTargetHeaterCoolerStates();

        this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
            .onSet(this.setTemperatureDisplayUnits.bind(this))
            .onGet(this.getTemperatureDisplayUnits.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.getCurrentTemperature.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).props.minValue = -50;
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).props.maxValue = 70;
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).props.minStep = 0.5;

        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
            .onSet(this.setCoolingThresholdTemperature.bind(this))
            .onGet(this.getCoolingThresholdTemperature.bind(this));
        const cool = this.device.state!.max![WorkMode.COOL + ''];
        this.service.getCharacteristic(this.characterisitc.CoolingThresholdTemperature).props.minValue = cool.min;
        this.service.getCharacteristic(this.characterisitc.CoolingThresholdTemperature).props.maxValue = cool.max;
        this.service.getCharacteristic(this.characterisitc.CoolingThresholdTemperature).props.minStep = 0.5;

        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
            .onSet(this.setHeatingThresholdTemperature.bind(this))
            .onGet(this.getHeatingThresholdTemperature.bind(this));
        const heat = this.device.state!.max![WorkMode.HEAT + ''];
        this.service.getCharacteristic(this.characterisitc.HeatingThresholdTemperature).props.minValue = heat.min;
        this.service.getCharacteristic(this.characterisitc.HeatingThresholdTemperature).props.maxValue = heat.max;
        this.service.getCharacteristic(this.characterisitc.HeatingThresholdTemperature).props.minStep = 0.5;

        if (this.device.capabilities?.hasswing === 1) {
            this.service.getCharacteristic(this.platform.Characteristic.SwingMode)
                .onSet(this.setSwingMode.bind(this))
                .onGet(this.getSwingMode.bind(this));
        }
    }

    protected getServiceType() : typeof Service {
        return this.platform.Service.HeaterCooler;
    }

    protected getDeviceRoom(): string {
        return this.device.room;
    }

    protected getDeviceName() : string {
        return this.device.name!;
    }

    private getSupportedTargetHeaterCoolerStates(): number[] {
        const c = this.platform.Characteristic.TargetHeaterCoolerState;
        const values = [c.COOL];
        if (this.device.capabilities?.hascoolonly !== 1) {
            values.push(c.HEAT);
        }
        if (this.device.capabilities?.hasautomode === 1) {
            values.push(c.AUTO);
        }
        return values;
    }

    async getActive(): Promise<CharacteristicValue> {
        if (this.device.state?.setmode === WorkMode.DRY ||
        this.device.state?.setmode === WorkMode.FAN) {
            return this.platform.Characteristic.Active.INACTIVE;
        } else {
            return this.device.state!.power === 0?
                this.platform.Characteristic.Active.INACTIVE:
                this.platform.Characteristic.Active.ACTIVE;
        }
    }

    async setActive(value: CharacteristicValue) {
        await this.applyResponse(await this.platform.melviewService?.command(
            new CommandPower(value, this.device, this.platform)));
        // Default value
        // let v = -1;
        // switch (this.device.state?.setmode) {
        //     case WorkMode.HEAT:
        //         v = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
        //         break;
        //     case WorkMode.COOL:
        //         v = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
        //         break;
        //     case WorkMode.AUTO:
        //         v = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
        //         break;
        // }
        // if (v !== -1) {
        //     this.log.info('Setting', this.getDeviceName(), '=', value===0?'OFF':'ON');
        //     this.platform.melviewService?.command(
        //         new CommandPower(value, this.device, this.platform),
        //         new CommandTargetHeaterCoolerState(v, this.device, this.platform));
        // }
    }

    async setCoolingThresholdTemperature(value: CharacteristicValue) {
        this.platform.log.debug('setCoolingThresholdTemperature ->', value);
        const temperature = Number(value);
        const minVal = this.service.getCharacteristic(this.characterisitc.CoolingThresholdTemperature).props.minValue!;
        const maxVal = this.service.getCharacteristic(this.characterisitc.CoolingThresholdTemperature).props.maxValue!;
        let targetTemperature = temperature;
        if (temperature < minVal) {
            this.platform.log.warn('setCoolingThresholdTemperature ->', temperature, 'is illegal - updating to', minVal);
            targetTemperature = minVal;
        } else if (temperature > maxVal) {
            this.platform.log.warn('setCoolingThresholdTemperature ->', temperature, 'is illegal - updating to', maxVal);
            targetTemperature = maxVal;
        }
        await this.applyResponse(await this.platform.melviewService?.command(
            new CommandTemperature(targetTemperature, this.device, this.platform)));
    }

    async getCoolingThresholdTemperature(): Promise<CharacteristicValue> {
        const temp = parseFloat(this.device.state!.settemp)
        const minVal = this.service.getCharacteristic(this.characterisitc.CoolingThresholdTemperature).props.minValue!;
        const maxVal = this.service.getCharacteristic(this.characterisitc.CoolingThresholdTemperature).props.maxValue!;
        if (temp < minVal) {
            return minVal;
        } else if (temp > maxVal) {
            return maxVal;
        }
        return temp;
    }

    async setHeatingThresholdTemperature(value: CharacteristicValue) {
        this.platform.log.debug('setHeatingThresholdTemperature:', value);
        const temperature = Number(value);
        const minVal = this.service.getCharacteristic(this.characterisitc.HeatingThresholdTemperature).props.minValue!;
        const maxVal = this.service.getCharacteristic(this.characterisitc.HeatingThresholdTemperature).props.maxValue!;
        let targetTemperature = temperature;
        if (temperature < minVal) {
            this.platform.log.warn('setHeatingThresholdTemperature ->', temperature, 'is illegal - updating to', minVal);
            targetTemperature = minVal;
        } else if (temperature > maxVal) {
            this.platform.log.warn('setHeatingThresholdTemperature ->', temperature, 'is illegal - updating to', maxVal);
            targetTemperature = maxVal;
        }

        await this.applyResponse(await this.platform.melviewService?.command(
            new CommandTemperature(targetTemperature, this.device, this.platform)));
    }

    async getHeatingThresholdTemperature(): Promise<CharacteristicValue> {
        const temp = parseFloat(this.device.state!.settemp)
        const minVal = this.service.getCharacteristic(this.characterisitc.HeatingThresholdTemperature).props.minValue!;
        const maxVal = this.service.getCharacteristic(this.characterisitc.HeatingThresholdTemperature).props.maxValue!;
        if (temp < minVal) {
            return minVal;
        } else if (temp > maxVal) {
            return maxVal;
        }
        return temp;
    }

    async getCurrentHeaterCoolerState(mode?:number): Promise<CharacteristicValue> {
        if (!mode) {
            mode = this.device.state!.setmode;
        }
        const c = this.platform.api.hap.Characteristic;
        const roomTemp = parseFloat(this.device.state!.roomtemp);
        const targTemp = parseFloat(this.device.state!.settemp);
        switch (mode) {
            case WorkMode.COOL:
                this.platform.log.debug('getCurrentHeaterCoolerState: COOLING');
                return c.CurrentHeaterCoolerState.COOLING;
            case WorkMode.DRY:
            case WorkMode.FAN:
                this.platform.log.debug('getCurrentHeaterCoolerState: IDLE');
                return c.CurrentHeaterCoolerState.IDLE;
            case WorkMode.HEAT:
                this.platform.log.debug('getCurrentHeaterCoolerState: HEATING');
                return c.CurrentHeaterCoolerState.HEATING;
            case WorkMode.AUTO:
                if (roomTemp < targTemp) {
                    this.platform.log
                        .debug('getCurrentHeaterCoolerState (AUTO): HEATING, Target:',
                            targTemp, ' Room:', roomTemp);
                    return c.CurrentHeaterCoolerState.HEATING;
                } else if (roomTemp > targTemp) {
                    this.platform.log
                        .debug('getCurrentHeaterCoolerState (AUTO): COOLING, Target:',
                            targTemp, ' Room:', roomTemp);
                    return c.CurrentHeaterCoolerState.COOLING;
                } else {
                    this.platform.log
                        .debug('getCurrentHeaterCoolerState (AUTO): IDLE, Target:',
                            targTemp, ' Room:', roomTemp);
                    return c.CurrentHeaterCoolerState.IDLE;
                }
        }
        this.platform.log
            .error('getCurrentHeaterCoolerState (UNKNOWN STATE)', mode);
        return c.CurrentHeaterCoolerState.INACTIVE;
    }

    async setTargetHeaterCoolerState(value: CharacteristicValue) {
        this.platform.log.debug('setTargetHeaterCoolerState ->', value);
        await this.applyResponse(await this.platform.melviewService?.command(
            new CommandTargetHeaterCoolerState(value, this.device, this.platform)));
    }

    async getTargetHeaterCoolerState(): Promise<CharacteristicValue> {
        const mode = this.device.state!.setmode;
        const c = this.platform.api.hap.Characteristic;
        switch (mode) {
            case WorkMode.HEAT:
                this.platform.log.debug('getTargetHeaterCoolerState -> HEAT');
                return c.TargetHeaterCoolerState.HEAT;
            case WorkMode.COOL: /*case WorkMode.FAN: case WorkMode.DRY:*/
                this.platform.log.debug('getTargetHeaterCoolerState -> COOL');
                return c.TargetHeaterCoolerState.COOL;
            case WorkMode.AUTO:
                this.platform.log.debug('getTargetHeaterCoolerState -> AUTO');
                return c.TargetHeaterCoolerState.AUTO;
        }
        this.platform.log.debug('getTargetHeaterCoolerState -> AUTO');
        return c.TargetHeaterCoolerState.AUTO;
    }

    async setTemperatureDisplayUnits(value: CharacteristicValue) {
        if (value !== this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS) {
            this.platform.log.warn('TemperatureDisplayUnits -> Fahrenheit requested, keeping Celsius for MELView.');
            this.service.updateCharacteristic(
                this.platform.Characteristic.TemperatureDisplayUnits,
                this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
            );
        }
    }

    async getTemperatureDisplayUnits(): Promise<CharacteristicValue> {
        return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
    }

    async getCurrentTemperature(): Promise<CharacteristicValue> {
        return parseFloat(this.device.state!.roomtemp);
    }

    async setRotationSpeed(value: CharacteristicValue) {
        this.platform.log.debug('RotationSpeed ->', value);
        await this.applyResponse(await this.platform.melviewService?.command(
            new CommandRotationSpeed(value, this.device, this.platform)));
    }

    async getRotationSpeed(): Promise<CharacteristicValue> {
        return this.fanSpeedToRotationSpeed(this.device.state?.setfan);
    }

    async setSwingMode(value: CharacteristicValue) {
        this.platform.log.debug('SwingMode ->', value);
        await this.applyResponse(await this.platform.melviewService?.command(
            new CommandSwingMode(value, this.device, this.platform)));
    }

    async getSwingMode(): Promise<CharacteristicValue> {
        return this.device.state?.airdir === 7 ?
            this.platform.Characteristic.SwingMode.SWING_ENABLED :
            this.platform.Characteristic.SwingMode.SWING_DISABLED;
    }

    public async updateCharacteristics(): Promise<void> {
        await super.updateCharacteristics();
        const c = this.platform.Characteristic;
        this.service.updateCharacteristic(c.CurrentHeaterCoolerState, await this.getCurrentHeaterCoolerState());
        this.service.updateCharacteristic(c.TargetHeaterCoolerState, await this.getTargetHeaterCoolerState());
        this.service.updateCharacteristic(c.TemperatureDisplayUnits, await this.getTemperatureDisplayUnits());
        this.service.updateCharacteristic(c.CurrentTemperature, await this.getCurrentTemperature());
        this.service.updateCharacteristic(c.CoolingThresholdTemperature, await this.getCoolingThresholdTemperature());
        this.service.updateCharacteristic(c.HeatingThresholdTemperature, await this.getHeatingThresholdTemperature());
        if (this.device.capabilities?.hasswing === 1) {
            this.service.updateCharacteristic(c.SwingMode, await this.getSwingMode());
        }
    }
}
