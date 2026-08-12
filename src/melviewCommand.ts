import {MelviewMitsubishiHomebridgePlatform} from './platform';
import {Unit, WorkMode} from './data';

export interface Command {
    execute(): string;
    getUnitID(): string;
    /** The unit's LAN endpoint, or undefined when MELView reported no local IP. */
    getLocalCommandURL(): string | undefined;
    getLocalCommandBody(key: string): string;
}

export abstract class AbstractCommand implements Command{
  public constructor(protected value: number,
                          protected device: Unit,
                          protected platform: MelviewMitsubishiHomebridgePlatform) {
  }

    public abstract execute(): string;

    public getUnitID(): string {
      return this.device.unitid;
    }

    public getLocalCommandURL(): string | undefined {
      const localip = this.device.capabilities?.localip;
      return localip ? 'http://' + localip + '/smart' : undefined;
    }

    public getLocalCommandBody(key: string): string {
      return '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<ESV>' + key + '</ESV>';
    }
}

export class CommandPower extends AbstractCommand {
  public execute(): string {
        this.device.state!.power = this.value;
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

/**
 * Sets the fan speed. Takes a MELView fan code (0 = auto/off) rather than a
 * slider percentage - the caller already knows the unit's ladder, so converting
 * back and forth here would only lose precision.
 */
export class CommandFanCode extends AbstractCommand {
  public execute(): string {
    this.device.state!.setfan = this.value;
    return 'FS' + this.value;
  }
}

export class CommandTemperature extends AbstractCommand {
  public execute(): string {
        this.device.state!.settemp = String(this.value);
        return 'TS' + this.device.state!.settemp;
  }
}
