import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    fanCodeToRotationSpeed,
    fanMinRotation,
    fanRotationStep,
    rotationSpeedToFanCode,
} from '../src/fanMapping';
import {Capabilities} from '../src/data';

function caps(partial: Partial<Capabilities>): Capabilities {
    return partial as Capabilities;
}

// The 5-stage ladder is the proven, shipped behaviour and must not regress.
test('5-stage unit maps the proven ladder [1,2,3,5,6]', () => {
    const c = caps({fanstage: 5, hasautofan: 0});
    assert.equal(fanRotationStep(c), 20);
    assert.equal(fanMinRotation(c), 20);

    assert.equal(rotationSpeedToFanCode(20, c), 1);
    assert.equal(rotationSpeedToFanCode(40, c), 2);
    assert.equal(rotationSpeedToFanCode(60, c), 3);
    assert.equal(rotationSpeedToFanCode(80, c), 5);
    assert.equal(rotationSpeedToFanCode(100, c), 6);

    assert.equal(fanCodeToRotationSpeed(1, c), 20);
    assert.equal(fanCodeToRotationSpeed(2, c), 40);
    assert.equal(fanCodeToRotationSpeed(3, c), 60);
    assert.equal(fanCodeToRotationSpeed(5, c), 80);
    assert.equal(fanCodeToRotationSpeed(6, c), 100);
});

test('round-trips every 5-stage code through the slider and back', () => {
    const c = caps({fanstage: 5, hasautofan: 0});
    for (const code of [1, 2, 3, 5, 6]) {
        const speed = fanCodeToRotationSpeed(code, c) as number;
        assert.equal(rotationSpeedToFanCode(speed, c), code, `code ${code}`);
    }
});

test('missing capabilities falls back to the 5-stage ladder', () => {
    assert.equal(fanRotationStep(undefined), 20);
    assert.equal(rotationSpeedToFanCode(100, undefined), 6);
    assert.equal(fanCodeToRotationSpeed(5, undefined), 80);
});

test('auto fan makes 0 selectable and maps 0 to auto code', () => {
    const c = caps({fanstage: 5, hasautofan: 1});
    assert.equal(fanMinRotation(c), 0);
    assert.equal(rotationSpeedToFanCode(0, c), 0);
    assert.equal(fanCodeToRotationSpeed(0, c), 0);
});

test('without auto fan the slider floor is the lowest real speed', () => {
    const c = caps({fanstage: 5, hasautofan: 0});
    assert.equal(fanMinRotation(c), 20);
});

test('3-stage unit exposes three detents and round-trips each code', () => {
    const c = caps({fanstage: 3, hasautofan: 0});
    // Uniform steps over 0-100 can't land exactly on 100 for non-divisors of
    // 100, so the top detent is ~99.9. This is cosmetic and only affects odd
    // (non-5) stage counts; the proven 5-stage path stays exact.
    assert.equal(fanRotationStep(c), 33.3);
    assert.equal(rotationSpeedToFanCode(100, c), 5);
    for (const code of [1, 3, 5]) {
        const speed = fanCodeToRotationSpeed(code, c) as number;
        assert.equal(rotationSpeedToFanCode(speed, c), code, `code ${code}`);
    }
});

test('unknown fan code falls back to the lowest speed rather than 0', () => {
    const c = caps({fanstage: 5, hasautofan: 0});
    assert.equal(fanCodeToRotationSpeed(4, c), 20);
});

test('undefined fan code reads as off/auto (0)', () => {
    const c = caps({fanstage: 5, hasautofan: 0});
    assert.equal(fanCodeToRotationSpeed(undefined, c), 0);
});
