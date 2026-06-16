import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    ControlSequenceOfOperation,
    controlSequenceFor,
    fanCodeToFanMode,
    fanCodeToPercent,
    FanMode,
    fromCentiDegrees,
    percentToFanCode,
    SystemMode,
    systemModeToCommand,
    toCentiDegrees,
    workModeToSystemMode,
} from '../src/matterMapping';
import {Capabilities, State, WorkMode} from '../src/data';

function caps(partial: Partial<Capabilities>): Capabilities {
    return partial as Capabilities;
}

test('temperatures convert to/from Matter centi-degrees', () => {
    assert.equal(toCentiDegrees('21'), 2100);
    assert.equal(toCentiDegrees(18.5), 1850);
    assert.equal(toCentiDegrees(''), undefined);
    assert.equal(toCentiDegrees(undefined), undefined);
    assert.equal(fromCentiDegrees(2100), 21);
});

test('work mode maps to Matter systemMode, off when unpowered', () => {
    assert.equal(workModeToSystemMode({power: 0, setmode: WorkMode.COOL} as State), SystemMode.Off);
    assert.equal(workModeToSystemMode({power: 1, setmode: WorkMode.HEAT} as State), SystemMode.Heat);
    assert.equal(workModeToSystemMode({power: 1, setmode: WorkMode.COOL} as State), SystemMode.Cool);
    assert.equal(workModeToSystemMode({power: 1, setmode: WorkMode.AUTO} as State), SystemMode.Auto);
    assert.equal(workModeToSystemMode({power: 1, setmode: WorkMode.DRY} as State), SystemMode.Dry);
    assert.equal(workModeToSystemMode({power: 1, setmode: WorkMode.FAN} as State), SystemMode.FanOnly);
});

test('inbound systemMode maps to power + work mode', () => {
    assert.deepEqual(systemModeToCommand(SystemMode.Off), {power: 0});
    assert.deepEqual(systemModeToCommand(SystemMode.Heat), {power: 1, workMode: WorkMode.HEAT});
    assert.deepEqual(systemModeToCommand(SystemMode.Cool), {power: 1, workMode: WorkMode.COOL});
    assert.deepEqual(systemModeToCommand(SystemMode.Auto), {power: 1, workMode: WorkMode.AUTO});
    assert.deepEqual(systemModeToCommand(SystemMode.Dry), {power: 1, workMode: WorkMode.DRY});
});

test('control sequence reflects cool-only capability', () => {
    assert.equal(controlSequenceFor(caps({hascoolonly: 1})), ControlSequenceOfOperation.CoolingOnly);
    assert.equal(controlSequenceFor(caps({hascoolonly: 0})), ControlSequenceOfOperation.CoolingAndHeating);
    assert.equal(controlSequenceFor(undefined), ControlSequenceOfOperation.CoolingAndHeating);
});

test('fan code maps to Matter fanMode buckets (5-stage)', () => {
    const c = caps({fanstage: 5, hasautofan: 0});
    assert.equal(fanCodeToFanMode(1, c), FanMode.Low);
    assert.equal(fanCodeToFanMode(3, c), FanMode.Medium);
    assert.equal(fanCodeToFanMode(6, c), FanMode.High);
    assert.equal(fanCodeToFanMode(0, c), FanMode.Off);
});

test('fan code 0 maps to Auto when the unit supports auto fan', () => {
    assert.equal(fanCodeToFanMode(0, caps({fanstage: 5, hasautofan: 1})), FanMode.Auto);
});

test('fan percent round-trips through code mapping (5-stage)', () => {
    const c = caps({fanstage: 5, hasautofan: 0});
    assert.equal(fanCodeToPercent(5, c), 80);
    assert.equal(percentToFanCode(80, c), 5);
    assert.equal(percentToFanCode(100, c), 6);
});
