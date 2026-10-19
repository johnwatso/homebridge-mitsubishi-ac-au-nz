import {Capabilities} from './data';

/**
 * Single source of truth for translating between HomeKit's RotationSpeed slider
 * (0-100) and MELView's discrete fan codes.
 *
 * MELView fan codes are hardware-specific. These ladders match fanStageInfo in
 * Mitsubishi's Wi-Fi Control app: https://app.melview.net/js/ex.js.
 */
const FAN_CODE_LADDERS: Record<number, number[]> = {
    1: [5],
    2: [2, 5],
    3: [2, 3, 5],
    4: [2, 3, 5, 6],
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
    const codes = fanCodes(capabilities);
    if (speed <= 0) {
        return hasAutoFan(capabilities) ? 0 : codes[0];
    }
    // Matter sends integer percentages: a three-stage medium speed is 67%,
    // which must not round up a second time to the highest fan code.
    const index = codes.findIndex((_, i) => Math.round(speed) <= Math.round((i + 1) * 100 / codes.length));
    return codes[index < 0 ? codes.length - 1 : index];
}

/** MELView fan code -> HomeKit RotationSpeed (0-100). */
export function fanCodeToRotationSpeed(code: number | undefined, capabilities?: Capabilities): number {
    if (code === undefined || code === 0) {
        return 0;
    }
    const codes = fanCodes(capabilities);
    const step = 100 / codes.length;
    const index = codes.indexOf(code);
    if (index < 0) {
        // Unknown code: fall back to the lowest real speed.
        return fanRotationStep(capabilities);
    }
    return Math.round((index + 1) * step * 10) / 10;
}
