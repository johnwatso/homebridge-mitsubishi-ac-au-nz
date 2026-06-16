import {CharacteristicValue, Logger, PlatformAccessory, Service} from 'homebridge';
import {MelviewMitsubishiHomebridgePlatform} from '../platform';
import {Unit} from '../data';
import {fanCodeToRotationSpeed, fanMinRotation, fanRotationStep} from '../fanMapping';

export abstract class AbstractService {
    protected service: Service;
    public readonly device: Unit;
    protected constructor(
        protected readonly platform: MelviewMitsubishiHomebridgePlatform,
        protected readonly accessory: PlatformAccessory,
    ) {
        this.device = accessory.context.device;
        if (!this.device.name) {
            this.device.name = this.device.room;
        }
        const serviceName = this.getDeviceRoom();
        this.log.info('Set Device:', serviceName)
        this.service = this.accessory.getService(this.getServiceType() as any) ||
            this.accessory.addService(this.getServiceType() as any);
        this.service.setCharacteristic(this.platform.Characteristic.Name, serviceName);

        this.service.getCharacteristic(this.platform.Characteristic.Active)
            .onSet(this.setActive.bind(this))
            .onGet(this.getActive.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
            .onSet(this.setRotationSpeed.bind(this))
            .onGet(this.getRotationSpeed.bind(this));
        const caps = this.device.capabilities;
        this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minValue =
            fanMinRotation(caps);
        this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.maxValue = 100;
        this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minStep =
            fanRotationStep(caps);

    }

    protected abstract getServiceType() : typeof Service
    protected abstract getDeviceRoom() : string;
    protected abstract getDeviceName() : string;

    get characterisitc() {
        return this.platform.api.hap.Characteristic;
    }

    public getService() : Service {
        return this.service!;
    }

    protected fanSpeedToRotationSpeed(fanSpeed?: number): CharacteristicValue {
        return fanCodeToRotationSpeed(fanSpeed, this.device.capabilities);
    }

    public async updateCharacteristics(): Promise<void> {
        this.service.updateCharacteristic(this.platform.Characteristic.Active, await this.getActive());
        this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, await this.getRotationSpeed());
    }

    abstract setActive(value: CharacteristicValue);

    abstract getActive(): Promise<CharacteristicValue>;

    abstract getRotationSpeed(): Promise<CharacteristicValue>;

    abstract setRotationSpeed(value: CharacteristicValue);

    protected get log () : Logger {
        return this.platform.log;
    }
}
