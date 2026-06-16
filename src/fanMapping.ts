import {Capabilities} from './data';

/**
 * Single source of truth for translating between HomeKit's RotationSpeed slider
 * (0-100) and MELView's discrete fan codes.
 *
 * MELView fan codes are hardware-specific. Mitsubishi 5-stage units historically
 * skip code 4, yielding the ladder [1, 2, 3, 5, 6]. The ladders for other stage
 * counts are best-effort and may need confirmation against specific hardware.
 */
const FAN_CODE_LADDERS: Record<number, number[]> = {
    1: [3],
    2: [2, 5],
    3: [1, 3, 5],
    4: [1, 2, 3, 5],
    5: [1, 2, 3, 5, 6],
};

export function hasAutoFan(capabilities?: Capabilities): boolean {
    return capabilities?.hasautofan === 1;
}

function fanCodes(capabilities?: Capabilities): number[] {
    const stages = capabilities?.fanstage && capabilities.fanstage > 0 ? capabilities.fanstage : 5;
    return FAN_CODE_LADDERS[stages] ?? FAN_CODE_LADDERS[5];
}

/** Distance between slider detents so the top stage lands exactly on 100. */
export function fanRotationStep(capabilities?: Capabilities): number {
    const codes = fanCodes(capabilities);
    return Math.round((100 / codes.length) * 10) / 10;
}

/**
 * Lowest selectable slider value. When the unit supports auto fan, 0 is
 * selectable and maps to auto; otherwise the slider floor is the lowest speed.
 */
export function fanMinRotation(capabilities?: Capabilities): number {
    return hasAutoFan(capabilities) ? 0 : fanRotationStep(capabilities);
}

/** HomeKit RotationSpeed (0-100) -> MELView fan code (0 = auto/off). */
export function rotationSpeedToFanCode(speed: number, capabilities?: Capabilities): number {
    if (speed <= 0) {
        return 0;
    }
    const codes = fanCodes(capabilities);
    const step = 100 / codes.length;
    const index = Math.min(codes.length - 1, Math.max(0, Math.ceil(speed / step) - 1));
    return codes[index];
}

/** MELView fan code -> HomeKit RotationSpeed (0-100). */
export function fanCodeToRotationSpeed(code: number | undefined, capabilities?: Capabilities): number {
    if (code === undefined || code === 0) {
        return 0;
    }
    const codes = fanCodes(capabilities);
    const step = fanRotationStep(capabilities);
    const index = codes.indexOf(code);
    if (index < 0) {
        // Unknown code: fall back to the lowest real speed.
        return step;
    }
    return Math.round((index + 1) * step * 10) / 10;
}
