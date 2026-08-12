import {Capabilities, Range, State, WorkMode} from './data';
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
 * Which optional modes a given unit will actually accept. The Matter device
 * type advertises a fixed set of thermostat modes regardless, so this gates the
 * inbound direction: a mode the hardware can't do is refused rather than sent
 * to MELView as a command the unit will ignore.
 */
export interface ModeSupport {
    auto: boolean;
    dry: boolean;
    heat: boolean;
}

export function modeSupportFor(capabilities?: Capabilities, dryEnabled = false): ModeSupport {
    return {
        auto: capabilities?.hasautomode === 1,
        dry: dryEnabled && capabilities?.hasdrymode === 1,
        heat: capabilities?.hascoolonly !== 1,
    };
}

/**
 * Inbound: a Matter systemMode write from the Home app -> the MELView power and
 * (optionally) work mode to apply. `Off` only powers down; any active mode
 * implies power on. Returns undefined when the unit does not support the
 * requested mode, so the caller can refuse it instead of sending a no-op.
 */
export function systemModeToCommand(systemMode: number, support: ModeSupport):
    { power: 0 | 1; workMode?: WorkMode } | undefined {
    switch (systemMode) {
        case SystemMode.Off:
            return {power: 0};
        case SystemMode.Heat:
            return support.heat ? {power: 1, workMode: WorkMode.HEAT} : undefined;
        case SystemMode.Cool:
            return {power: 1, workMode: WorkMode.COOL};
        case SystemMode.Auto:
            return support.auto ? {power: 1, workMode: WorkMode.AUTO} : undefined;
        case SystemMode.Dry:
            return support.dry ? {power: 1, workMode: WorkMode.DRY} : undefined;
        case SystemMode.FanOnly:
            return {power: 1, workMode: WorkMode.FAN};
        default:
            return undefined;
    }
}

export interface SetpointLimits {
    cool: Range;
    heat: Range;
}

export function clampToRange(value: number, range: Range): number {
    return Math.min(Math.max(value, range.min), range.max);
}

/**
 * MELView exposes a single setpoint, but Matter carries separate heating and
 * cooling setpoints and validates each against its own limits - writing one
 * outside its range throws a ConstraintError that drops the whole thermostat
 * update. So clamp the single value into each range independently.
 *
 * Returns centi-°C, or undefined when the unit reported no usable setpoint.
 */
export function occupiedSetpoints(settemp: string | number | undefined, limits: SetpointLimits):
    { occupiedCoolingSetpoint: number; occupiedHeatingSetpoint: number } | undefined {
    const value = typeof settemp === 'number' ? settemp : Number.parseFloat(settemp ?? '');
    if (!Number.isFinite(value)) {
        return undefined;
    }
    const cool = clampToRange(value, limits.cool);
    // Auto mode additionally rejects a heating setpoint above the cooling one,
    // which differing per-mode limits can produce at the top of the range.
    const heat = Math.max(Math.min(clampToRange(value, limits.heat), cool), limits.heat.min);
    return {
        occupiedCoolingSetpoint: Math.round(cool * 100),
        occupiedHeatingSetpoint: Math.round(heat * 100),
    };
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
