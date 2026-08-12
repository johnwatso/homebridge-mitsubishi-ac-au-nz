import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clusters} from 'homebridge';
import {
    ControlSequenceOfOperation,
    controlSequenceFor,
    fanCodeToFanMode,
    fanCodeToPercent,
    FanMode,
    FanModeSequence,
    fromCentiDegrees,
    ModeSupport,
    modeSupportFor,
    occupiedSetpoints,
    percentToFanCode,
    SystemMode,
    systemModeToCommand,
    ThermostatRunningMode,
    toCentiDegrees,
    workModeToSystemMode,
} from '../src/matterMapping';
import {Capabilities, State, WorkMode} from '../src/data';

function caps(partial: Partial<Capabilities>): Capabilities {
    return partial as Capabilities;
}

/** A unit that supports everything, so mode gating doesn't confuse other cases. */
const FULL_SUPPORT: ModeSupport = {auto: true, dry: true, heat: true};

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
    assert.deepEqual(systemModeToCommand(SystemMode.Off, FULL_SUPPORT), {power: 0});
    assert.deepEqual(systemModeToCommand(SystemMode.Heat, FULL_SUPPORT), {power: 1, workMode: WorkMode.HEAT});
    assert.deepEqual(systemModeToCommand(SystemMode.Cool, FULL_SUPPORT), {power: 1, workMode: WorkMode.COOL});
    assert.deepEqual(systemModeToCommand(SystemMode.Auto, FULL_SUPPORT), {power: 1, workMode: WorkMode.AUTO});
    assert.deepEqual(systemModeToCommand(SystemMode.Dry, FULL_SUPPORT), {power: 1, workMode: WorkMode.DRY});
    assert.deepEqual(systemModeToCommand(SystemMode.FanOnly, FULL_SUPPORT), {power: 1, workMode: WorkMode.FAN});
});

test('modes the unit cannot do are refused rather than sent to MELView', () => {
    const support = modeSupportFor(caps({hasautomode: 0, hasdrymode: 0, hascoolonly: 1}), true);
    assert.equal(systemModeToCommand(SystemMode.Auto, support), undefined);
    assert.equal(systemModeToCommand(SystemMode.Dry, support), undefined);
    assert.equal(systemModeToCommand(SystemMode.Heat, support), undefined);
    // Cool and off stay available on every unit.
    assert.deepEqual(systemModeToCommand(SystemMode.Cool, support), {power: 1, workMode: WorkMode.COOL});
    assert.deepEqual(systemModeToCommand(SystemMode.Off, support), {power: 0});
});

test('dry needs both the capability and the config opt-in', () => {
    const dryCapable = caps({hasdrymode: 1});
    assert.equal(modeSupportFor(dryCapable, true).dry, true);
    assert.equal(modeSupportFor(dryCapable, false).dry, false);
    assert.equal(modeSupportFor(caps({hasdrymode: 0}), true).dry, false);
    assert.equal(modeSupportFor(undefined, true).dry, false);
});

test('auto and heat support are read from the unit capabilities', () => {
    assert.equal(modeSupportFor(caps({hasautomode: 1})).auto, true);
    assert.equal(modeSupportFor(caps({hasautomode: 0})).auto, false);
    assert.equal(modeSupportFor(caps({hascoolonly: 1})).heat, false);
    assert.equal(modeSupportFor(caps({hascoolonly: 0})).heat, true);
});

test('an unrecognised systemMode is ignored rather than powering the unit off', () => {
    assert.equal(systemModeToCommand(99, FULL_SUPPORT), undefined);
});

test('the single MELView setpoint is clamped into each mode range', () => {
    const limits = {cool: {min: 16, max: 31}, heat: {min: 10, max: 31}};

    // Regression: a heat-mode setpoint below the cooling minimum used to be
    // written unclamped, which Matter rejects with a ConstraintError.
    assert.deepEqual(occupiedSetpoints('12', limits),
        {occupiedCoolingSetpoint: 1600, occupiedHeatingSetpoint: 1200});
    assert.deepEqual(occupiedSetpoints('21', limits),
        {occupiedCoolingSetpoint: 2100, occupiedHeatingSetpoint: 2100});
    assert.deepEqual(occupiedSetpoints('35', limits),
        {occupiedCoolingSetpoint: 3100, occupiedHeatingSetpoint: 3100});
});

test('the heating setpoint never lands above the cooling one', () => {
    // Auto mode rejects an inverted pair; differing maxima could otherwise produce it.
    const limits = {cool: {min: 16, max: 28}, heat: {min: 10, max: 31}};
    const setpoints = occupiedSetpoints('31', limits)!;
    assert.ok(setpoints.occupiedCoolingSetpoint >= setpoints.occupiedHeatingSetpoint);
    assert.deepEqual(setpoints, {occupiedCoolingSetpoint: 2800, occupiedHeatingSetpoint: 2800});
});

test('an unusable setpoint is omitted rather than sent as NaN', () => {
    const limits = {cool: {min: 16, max: 31}, heat: {min: 10, max: 31}};
    assert.equal(occupiedSetpoints('', limits), undefined);
    assert.equal(occupiedSetpoints(undefined, limits), undefined);
});

test('the hand-written Matter enum values match the spec definitions', () => {
    assert.deepEqual({...SystemMode}, {
        Off: clusters.Thermostat.SystemMode.Off,
        Auto: clusters.Thermostat.SystemMode.Auto,
        Cool: clusters.Thermostat.SystemMode.Cool,
        Heat: clusters.Thermostat.SystemMode.Heat,
        FanOnly: clusters.Thermostat.SystemMode.FanOnly,
        Dry: clusters.Thermostat.SystemMode.Dry,
    });
    assert.deepEqual({...ControlSequenceOfOperation}, {
        CoolingOnly: clusters.Thermostat.ControlSequenceOfOperation.CoolingOnly,
        HeatingOnly: clusters.Thermostat.ControlSequenceOfOperation.HeatingOnly,
        CoolingAndHeating: clusters.Thermostat.ControlSequenceOfOperation.CoolingAndHeating,
    });
    assert.deepEqual({...ThermostatRunningMode}, {
        Off: clusters.Thermostat.ThermostatRunningMode.Off,
        Cool: clusters.Thermostat.ThermostatRunningMode.Cool,
        Heat: clusters.Thermostat.ThermostatRunningMode.Heat,
    });
    assert.deepEqual({...FanMode}, {
        Off: clusters.FanControl.FanMode.Off,
        Low: clusters.FanControl.FanMode.Low,
        Medium: clusters.FanControl.FanMode.Medium,
        High: clusters.FanControl.FanMode.High,
        On: clusters.FanControl.FanMode.On,
        Auto: clusters.FanControl.FanMode.Auto,
    });
    assert.deepEqual({...FanModeSequence}, {
        OffLowMedHigh: clusters.FanControl.FanModeSequence.OffLowMedHigh,
        OffLowMedHighAuto: clusters.FanControl.FanModeSequence.OffLowMedHighAuto,
    });
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
