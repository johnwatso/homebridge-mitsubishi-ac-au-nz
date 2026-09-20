import {test} from 'node:test';
import assert from 'node:assert/strict';

import {MelviewMitsubishiHomebridgePlatform} from '../src/platform';
import {State, Unit, WorkMode} from '../src/data';
import {
    CommandFanCode,
    CommandPower,
    CommandTemperature,
    CommandWorkMode,
} from '../src/melviewCommand';

function unit(): Unit {
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
        state: {
            power: 0,
            setmode: WorkMode.COOL,
            setfan: 1,
            settemp: '21',
        } as State,
    };
}

const platform = {} as MelviewMitsubishiHomebridgePlatform;

test('serialising commands does not mutate state before MELView accepts them', () => {
    const device = unit();
    const commands = [
        new CommandPower(1, device, platform),
        new CommandWorkMode(WorkMode.HEAT, device, platform),
        new CommandFanCode(5, device, platform),
        new CommandTemperature(23.5, device, platform),
    ];

    assert.deepEqual(commands.map(command => command.execute()), ['PW1', 'MD1', 'FS5', 'TS23.5']);
    assert.deepEqual(
        {
            power: device.state!.power,
            setmode: device.state!.setmode,
            setfan: device.state!.setfan,
            settemp: device.state!.settemp,
        },
        {power: 0, setmode: WorkMode.COOL, setfan: 1, settemp: '21'},
    );
});

test('accepted commands apply their requested values to the cached state', () => {
    const device = unit();
    const commands = [
        new CommandPower(1, device, platform),
        new CommandWorkMode(WorkMode.HEAT, device, platform),
        new CommandFanCode(5, device, platform),
        new CommandTemperature(23.5, device, platform),
    ];

    commands.forEach(command => command.apply());

    assert.equal(device.state!.power, 1);
    assert.equal(device.state!.setmode, WorkMode.HEAT);
    assert.equal(device.state!.setfan, 5);
    assert.equal(device.state!.settemp, '23.5');
});
