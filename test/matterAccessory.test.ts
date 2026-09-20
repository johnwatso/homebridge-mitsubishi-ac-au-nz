import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API, Logger, MatterAccessory, PlatformConfig} from 'homebridge';

import {Capabilities, CommandResponse, State, Unit, WorkMode} from '../src/data';
import {MelviewMatterAccessory} from '../src/matterAccessory';
import {Command} from '../src/melviewCommand';
import {MelviewMitsubishiHomebridgePlatform} from '../src/platform';

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
