import {CharacteristicValue, Logger, PlatformAccessory, Service} from 'homebridge';
import {MelviewMitsubishiHomebridgePlatform} from '../platform';
import {Unit} from '../data';

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
        this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minValue =
            this.device.capabilities?.hasautofan === 1 ? 0 : 20;
        this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.maxValue = 100;
        this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).props.minStep = 20;

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
        switch (fanSpeed) {
            case 0:
                return 0;
            case 1:
                return 20;
            case 2:
                return 40;
            case 3:
                return 60;
            case 5:
                return 80;
            case 6:
                return 100;
            default:
                return 20;
        }
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
