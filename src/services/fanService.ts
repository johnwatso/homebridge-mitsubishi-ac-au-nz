import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {WithUUID} from 'hap-nodejs';

import {WorkMode} from '../data';
import {CommandPower, CommandRotationSpeed, CommandSwingMode, CommandTargetFanState} from '../melviewCommand';
import {MelviewMitsubishiHomebridgePlatform} from '../platform';
import {AbstractService} from './abstractService';

export class FanService extends AbstractService {
  public constructor(
    protected readonly platform: MelviewMitsubishiHomebridgePlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentFanState)
      .onGet(this.getCurrentFanState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetFanState)
      .onSet(this.setTargetFanState.bind(this))
      .onGet(this.getTargetFanState.bind(this));

    if (this.device.capabilities?.hasswing === 1) {
      this.service.getCharacteristic(this.platform.Characteristic.SwingMode)
        .onSet(this.setSwingMode.bind(this))
        .onGet(this.getSwingMode.bind(this));
    }
  }

  protected getServiceType<T extends WithUUID<typeof Service>>(): T {
    return this.platform.Service.Fanv2 as T;
  }

  protected getDeviceRoom(): string {
    return this.device.room + ' Fan';
  }

  protected getDeviceName(): string {
    return this.device.name!;
  }

  async getActive(): Promise<CharacteristicValue> {
    if (this.device.state?.power === 1 && this.device.state?.setmode === WorkMode.FAN) {
      return this.platform.Characteristic.Active.ACTIVE;
    }
    return this.platform.Characteristic.Active.INACTIVE;
  }

  async setActive(value: CharacteristicValue) {
    const active = value === this.platform.Characteristic.Active.ACTIVE;
    if (!active && this.device.state?.setmode !== WorkMode.FAN) {
      return;
    }

    await this.platform.melviewService?.command(
      new CommandPower(active ? 1 : 0, this.device, this.platform),
      ...(active ? [new CommandTargetFanState(value, this.device, this.platform)] : []),
    );
  }

  async getCurrentFanState(): Promise<CharacteristicValue> {
    const c = this.platform.Characteristic.CurrentFanState;
    if (this.device.state?.power !== 1) {
      return c.INACTIVE;
    }
    return this.device.state?.setmode === WorkMode.FAN ? c.BLOWING_AIR : c.IDLE;
  }

  async setTargetFanState(value: CharacteristicValue) {
    const fanSpeed = value === this.platform.Characteristic.TargetFanState.AUTO ?
      0 :
      this.device.state!.setfan;
    await this.platform.melviewService?.command(
      new CommandRotationSpeed(fanSpeed, this.device, this.platform),
    );
  }

  async getTargetFanState(): Promise<CharacteristicValue> {
    return this.device.state?.setfan === 0 ?
      this.platform.Characteristic.TargetFanState.AUTO :
      this.platform.Characteristic.TargetFanState.MANUAL;
  }

  async setRotationSpeed(value: CharacteristicValue) {
    this.platform.log.debug('Fan RotationSpeed ->', value);
    await this.platform.melviewService?.command(
      new CommandRotationSpeed(value, this.device, this.platform),
    );
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    return this.fanSpeedToRotationSpeed(this.device.state?.setfan);
  }

  async setSwingMode(value: CharacteristicValue) {
    this.platform.log.debug('Fan SwingMode ->', value);
    await this.platform.melviewService?.command(
      new CommandSwingMode(value, this.device, this.platform),
    );
  }

  async getSwingMode(): Promise<CharacteristicValue> {
    return this.device.state?.airdir === 7 ?
      this.platform.Characteristic.SwingMode.SWING_ENABLED :
      this.platform.Characteristic.SwingMode.SWING_DISABLED;
  }

  public async updateCharacteristics(): Promise<void> {
    await super.updateCharacteristics();
    const c = this.platform.Characteristic;
    this.service.updateCharacteristic(c.CurrentFanState, await this.getCurrentFanState());
    this.service.updateCharacteristic(c.TargetFanState, await this.getTargetFanState());
    if (this.device.capabilities?.hasswing === 1) {
      this.service.updateCharacteristic(c.SwingMode, await this.getSwingMode());
    }
  }
}
