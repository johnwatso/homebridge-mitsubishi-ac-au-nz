import {Capabilities, State, WorkMode} from './data';
import {fanCodeToRotationSpeed, hasAutoFan, rotationSpeedToFanCode} from './fanMapping';

/**
 * Pure translation between MELView state and Matter cluster state.
 *
 * Kept free of any homebridge/@matter imports so it can be unit-tested in
 * isolation (like fanMapping.ts). The numeric enum values below are the
 * Matter 1.x spec values for the Thermostat and FanControl clusters; the
 * accessory builder applies them to the real clusters.
 */

/** Matter Thermostat::SystemMode */
export const SystemMode = {
    Off: 0,
    Auto: 1,
    Cool: 3,
    Heat: 4,
    FanOnly: 7,
    Dry: 8,
} as const;

/** Matter Thermostat::ControlSequenceOfOperation */
export const ControlSequenceOfOperation = {
    CoolingOnly: 0,
    HeatingOnly: 2,
    CoolingAndHeating: 4,
} as const;

/** Matter Thermostat::ThermostatRunningMode */
export const ThermostatRunningMode = {
    Off: 0,
    Cool: 3,
    Heat: 4,
} as const;

/** Matter FanControl::FanMode */
export const FanMode = {
    Off: 0,
    Low: 1,
    Medium: 2,
    High: 3,
    On: 4,
    Auto: 5,
} as const;

/** Matter FanControl::FanModeSequence */
export const FanModeSequence = {
    OffLowMedHigh: 0,
    OffLowMedHighAuto: 2,
} as const;

/** Matter temperatures are int16 in 0.01 °C. */
export function toCentiDegrees(value: string | number | undefined): number | undefined {
    const n = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
    if (!Number.isFinite(n)) {
        return undefined;
    }
    return Math.round(n * 100);
}

/** Matter centi-°C -> plain °C. */
export function fromCentiDegrees(centi: number): number {
    return centi / 100;
}

/** MELView work mode + power -> Matter Thermostat systemMode. */
export function workModeToSystemMode(state: State): number {
    if (state.power === 0) {
        return SystemMode.Off;
    }
    switch (state.setmode) {
        case WorkMode.HEAT:
            return SystemMode.Heat;
        case WorkMode.COOL:
            return SystemMode.Cool;
        case WorkMode.AUTO:
            return SystemMode.Auto;
        case WorkMode.DRY:
            return SystemMode.Dry;
        case WorkMode.FAN:
            return SystemMode.FanOnly;
        default:
            return SystemMode.Off;
    }
}

/**
 * Inbound: a Matter systemMode write from the Home app -> the MELView power and
 * (optionally) work mode to apply. `Off` only powers down; any active mode
 * implies power on.
 */
export function systemModeToCommand(systemMode: number): { power: 0 | 1; workMode?: WorkMode } {
    switch (systemMode) {
        case SystemMode.Off:
            return {power: 0};
        case SystemMode.Heat:
            return {power: 1, workMode: WorkMode.HEAT};
        case SystemMode.Cool:
            return {power: 1, workMode: WorkMode.COOL};
        case SystemMode.Auto:
            return {power: 1, workMode: WorkMode.AUTO};
        case SystemMode.Dry:
            return {power: 1, workMode: WorkMode.DRY};
        case SystemMode.FanOnly:
            return {power: 1, workMode: WorkMode.FAN};
        default:
            return {power: 0};
    }
}

/** Running indicator for nicer Home display. */
export function workModeToRunningMode(state: State): number {
    if (state.power === 0) {
        return ThermostatRunningMode.Off;
    }
    switch (state.setmode) {
        case WorkMode.HEAT:
            return ThermostatRunningMode.Heat;
        case WorkMode.COOL:
            return ThermostatRunningMode.Cool;
        case WorkMode.AUTO:
            return Number.parseFloat(state.roomtemp) < Number.parseFloat(state.settemp) ?
                ThermostatRunningMode.Heat : ThermostatRunningMode.Cool;
        default:
            return ThermostatRunningMode.Off;
    }
}

export function controlSequenceFor(capabilities?: Capabilities): number {
    if (capabilities?.hascoolonly === 1) {
        return ControlSequenceOfOperation.CoolingOnly;
    }
    return ControlSequenceOfOperation.CoolingAndHeating;
}

/** MELView fan code -> Matter FanControl fanMode. */
export function fanCodeToFanMode(setfan: number | undefined, capabilities?: Capabilities): number {
    if (setfan === 0) {
        return hasAutoFan(capabilities) ? FanMode.Auto : FanMode.Off;
    }
    const percent = fanCodeToRotationSpeed(setfan, capabilities) as number;
    if (percent <= 33) {
        return FanMode.Low;
    }
    if (percent <= 66) {
        return FanMode.Medium;
    }
    return FanMode.High;
}

/** MELView fan code -> Matter FanControl percentSetting (0-100). */
export function fanCodeToPercent(setfan: number | undefined, capabilities?: Capabilities): number {
    return Math.round(fanCodeToRotationSpeed(setfan, capabilities) as number);
}

/** Inbound: Matter percentSetting (0-100) -> MELView fan code. */
export function percentToFanCode(percent: number | null, capabilities?: Capabilities): number {
    return rotationSpeedToFanCode(percent ?? 0, capabilities);
}

export function fanModeSequenceFor(capabilities?: Capabilities): number {
    return hasAutoFan(capabilities) ? FanModeSequence.OffLowMedHighAuto : FanModeSequence.OffLowMedHigh;
}
