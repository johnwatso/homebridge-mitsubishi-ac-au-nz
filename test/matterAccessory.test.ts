import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API, Logger, MatterAccessory, PlatformConfig} from 'homebridge';

import {Capabilities, CommandResponse, State, Unit, WorkMode} from '../src/data';
import {MelviewMatterAccessory} from '../src/matterAccessory';
import {Command} from '../src/melviewCommand';
import {MelviewMitsubishiHomebridgePlatform} from '../src/platform';
import {SystemMode} from '../src/matterMapping';

const noop = () => undefined;
const silentLog = {debug: noop, info: noop, warn: noop, error: noop, log: noop, success: noop} as unknown as Logger;

function device(): Unit {
    return {
        room: 'Study',
        unitid: 'unit-1',
        power: '0',
        wifi: '1',
        mode: '3',
        temp: '21',
        settemp: '21',
        status: 'ok',
        schedule1: 0,
        capabilities: {
            adaptortype: 'MAC-568IF-E',
            hasautomode: 1,
            hascoolonly: 0,
            hasautofan: 1,
            hasdrymode: 1,
            hasenergy: 0,
            fanstage: 5,
        } as Capabilities,
        state: {
            power: 0,
            setmode: WorkMode.COOL,
            automode: 0,
            setfan: 1,
            settemp: '21',
            roomtemp: '21',
            outdoortemp: '14',
            fault: '',
            error: 'ok',
        } as State,
    };
}

function platform(command: (first: Command, ...rest: Command[]) => Promise<CommandResponse>):
    MelviewMitsubishiHomebridgePlatform {
    const matter = {
        uuid: {generate: (value: string) => value},
        deviceTypes: {RoomAirConditioner: {}, TemperatureSensor: {}},
        updateAccessoryState: async () => undefined,
    };
    return {
        log: silentLog,
        config: {} as PlatformConfig,
        api: {matter} as unknown as API,
        melviewService: {command},
    } as unknown as MelviewMitsubishiHomebridgePlatform;
}

test('Matter commands for one unit are sent to MELView in order', async () => {
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>(resolve => {
        releaseFirst = resolve;
    });
    const calls: string[] = [];
    let active = 0;
    let maxActive = 0;

    const controller = new MelviewMatterAccessory(platform(async (first, ...rest) => {
        active++;
        maxActive = Math.max(maxActive, active);
        const serialised = [first, ...rest].map(command => command.execute());
        calls.push(serialised.join(','));
        if (calls.length === 1) {
            await firstMayFinish;
        }
        active--;
        return {error: 'ok', lc: ''} as CommandResponse;
    }), device());
    const accessory: MatterAccessory = controller.buildAccessories()[0];

    const turnOn = Promise.resolve(accessory.handlers!.onOff!.on!(undefined));
    const turnOff = Promise.resolve(accessory.handlers!.onOff!.off!(undefined));
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls, ['PW1']);
    assert.equal(maxActive, 1);

    releaseFirst();
    await Promise.all([turnOn, turnOff]);

    assert.deepEqual(calls, ['PW1', 'PW0']);
    assert.equal(maxActive, 1);
});

test('a status poll started before a command cannot overwrite the accepted command', async () => {
    let finishPoll!: (state: State) => void;
    const unit = device();
    const staleState = {...unit.state!};
    const p = platform(async () => ({error: 'ok', lc: ''} as CommandResponse));
    p.melviewService!.getStatus = () => new Promise(resolve => {
        finishPoll = resolve;
    });
    const controller = new MelviewMatterAccessory(p, unit);
    // Invoke the timer callback directly so this race is deterministic.
    (controller as unknown as {pollOnce(): void}).pollOnce();
    await controller.buildAccessories()[0].handlers!.onOff!.on!(undefined);
    finishPoll(staleState);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(unit.state!.power, 1);
});

test('polls are skipped while a command is pending', async () => {
    let finishCommand!: () => void;
    const p = platform(async () => {
        await new Promise<void>(resolve => {
            finishCommand = resolve;
        });
        return {error: 'ok', lc: ''} as CommandResponse;
    });
    let polls = 0;
    p.melviewService!.getStatus = async () => {
        polls++;
        return device().state!;
    };
    const controller = new MelviewMatterAccessory(p, device());
    const command = controller.buildAccessories()[0].handlers!.onOff!.on!(undefined);
    await new Promise(resolve => setImmediate(resolve));
    (controller as unknown as {pollOnce(): void}).pollOnce();
    finishCommand();
    await command;
    assert.equal(polls, 0);
});

test('heating setpoints use heating capabilities even when a mode change is queued', async () => {
    const unit = device();
    unit.capabilities!.max = {'1': {min: 10, max: 30}, '3': {min: 18, max: 28}};
    const calls: string[] = [];
    const controller = new MelviewMatterAccessory(platform(async (first, ...rest) => {
        calls.push([first, ...rest].map(c => c.execute()).join(','));
        return {error: 'ok', lc: ''} as CommandResponse;
    }), unit);
    const thermostat = controller.buildAccessories()[0].handlers!.thermostat!;
    await Promise.all([
        thermostat.systemModeChange!({systemMode: SystemMode.Heat}),
        thermostat.occupiedHeatingSetpointChange!({occupiedHeatingSetpoint: 1200}),
    ]);
    assert.deepEqual(calls, ['PW1,MD1', 'TS12']);
});

test('setpoints respect the unit temperature step', async () => {
    for (const [halfdeg, expected] of [[0, 'TS22'], [1, 'TS21.5']]) {
        const unit = device();
        unit.capabilities!.halfdeg = halfdeg as number;
        const calls: string[] = [];
        const controller = new MelviewMatterAccessory(platform(async first => {
            calls.push(first.execute());
            return {error: 'ok', lc: ''} as CommandResponse;
        }), unit);
        await controller.buildAccessories()[0].handlers!.thermostat!.occupiedCoolingSetpointChange!(
            {occupiedCoolingSetpoint: 2160});
        assert.deepEqual(calls, [expected]);
    }
});

test('an enabled outdoor tile survives a missing startup reading and later recovers', async () => {
    const unit = device();
    unit.state!.outdoortemp = '';
    const p = platform(async () => ({error: 'ok'} as CommandResponse));
    p.config.outdoorTemperature = true;
    const updates: unknown[] = [];
    p.api.matter!.updateAccessoryState = async (_uuid, cluster, state) => {
        if (cluster === 'temperatureMeasurement') {
updates.push(state);
}
    };
    const controller = new MelviewMatterAccessory(p, unit);
    const accessories = controller.buildAccessories();
    assert.equal(accessories.length, 2);
    assert.deepEqual(accessories[1].clusters!.temperatureMeasurement, {measuredValue: null});
    unit.state!.outdoortemp = '14';
    await controller.pushState();
    assert.deepEqual(updates, [{measuredValue: 1400}]);
});

test('a heating setpoint written while the unit is cooling respects the cooling limits', async () => {
    const unit = device();
    unit.capabilities!.max = {'1': {min: 10, max: 30}, '3': {min: 18, max: 28}};
    const calls: string[] = [];
    const controller = new MelviewMatterAccessory(platform(async first => {
        calls.push(first.execute());
        return {error: 'ok', lc: ''} as CommandResponse;
    }), unit);
    // MELView keeps one setpoint for every mode, so sending the heating minimum
    // to a cooling unit would ask for a temperature it cannot hold.
    await controller.buildAccessories()[0].handlers!.thermostat!.occupiedHeatingSetpointChange!(
        {occupiedHeatingSetpoint: 1000});
    assert.deepEqual(calls, ['TS18']);
});
