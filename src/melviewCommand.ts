import {CharacteristicValue} from 'homebridge';
import {MelviewMitsubishiHomebridgePlatform} from './platform';
import {Unit, WorkMode} from './data';
import {rotationSpeedToFanCode} from './fanMapping';

export interface Command {
    execute(): string;
    getUnitID(): string;
    getLocalCommandURL(): string;
    getLocalCommandBody(key: string): string;
}

export abstract class AbstractCommand implements Command{
  public constructor(protected value: CharacteristicValue,
                          protected device: Unit,
                          protected platform: MelviewMitsubishiHomebridgePlatform) {
  }

    public abstract execute(): string;

    public getUnitID(): string {
      return this.device.unitid;
    }

    public getLocalCommandURL(): string {
      return 'http://' + this.device.capabilities!.localip + '/smart';
    }

    public getLocalCommandBody(key: string): string {
      return '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<ESV>' + key + '</ESV>';
    }
}

export class CommandPower extends AbstractCommand {
  public execute(): string {
        this.device.state!.power = this.value as number;
        return 'PW' + this.value;
  }
}

export class CommandWorkMode extends AbstractCommand {
  public execute(): string {
    const workMode = this.value as WorkMode;
    this.device.state!.setmode = workMode;
    return 'MD' + workMode;
  }
}

export class CommandRotationSpeed extends AbstractCommand {
  public execute(): string {
    const code = rotationSpeedToFanCode(Number(this.value), this.device.capabilities);
    this.device.state!.setfan = code;
    return 'FS' + code;
  }
}

export class CommandTemperature extends AbstractCommand {
  public execute(): string {
        this.device.state!.settemp = String(this.value);
        return 'TS' + this.device.state!.settemp;
  }
}
