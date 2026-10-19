import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryRetryDelayMs} from '../src/platform';
import {MelviewMitsubishiHomebridgePlatform} from '../src/platform';
import {API, Logger, MatterAccessory, PlatformConfig} from 'homebridge';
import {EventEmitter} from 'node:events';
import {Building, Capabilities, State, Unit, WorkMode} from '../src/data';
import {fanRotationStep} from '../src/fanMapping';

function platformFixture() {
    const registered: MatterAccessory[] = [];
    const api = Object.assign(new EventEmitter(), {
        hap: {Service: {}, Characteristic: {}},
        isMatterEnabled: () => true,
        matter: {
            uuid: {generate: (value: string) => value},
            deviceTypes: {RoomAirConditioner: {}, TemperatureSensor: {}},
            updateAccessoryState: async () => undefined,
            registerPlatformAccessories: async (_p: string, _n: string, accessories: MatterAccessory[]) => {
                registered.push(...accessories);
            },
            unregisterPlatformAccessories: async () => undefined,
        },
    });
    const noop = () => undefined;
    const log = {debug: noop, info: noop, warn: noop, error: noop} as unknown as Logger;
    const platform = new MelviewMitsubishiHomebridgePlatform(log,
        {user: 'test', password: 'test'} as PlatformConfig, api as unknown as API);
    return {platform, api, registered};
}

test('discovery retries back off from 30s to a 10 minute cap', () => {
    assert.equal(discoveryRetryDelayMs(0), 30_000);
    assert.equal(discoveryRetryDelayMs(1), 60_000);
    assert.equal(discoveryRetryDelayMs(4), 480_000);
    assert.equal(discoveryRetryDelayMs(5), 600_000);
    assert.equal(discoveryRetryDelayMs(50), 600_000);
    assert.equal(discoveryRetryDelayMs(-1), 30_000);
});

test('a discovery failure after shutdown does not schedule another retry', async () => {
    const {platform, api} = platformFixture();
    let failDiscovery!: (reason: Error) => void;
    platform.melviewService!.discover = () => new Promise((_resolve, reject) => {
        failDiscovery = reject;
    });
    let retries = 0;
    platform.registerPollingInterval = timer => {
        retries++;
        clearTimeout(timer);
    };
    const discovery = platform.discoverDevices();
    api.emit('shutdown');
    failDiscovery(new Error('offline'));
    await discovery;
    assert.equal(retries, 0);
});

test('timers registered after shutdown are immediately cancelled', async () => {
    const {platform, api} = platformFixture();
    api.emit('shutdown');
    let fired = false;
    platform.registerPollingInterval(setTimeout(() => {
        fired = true;
}, 0));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fired, false);
});

test('a missing capabilities fan stage count falls back to the status response', async () => {
    const {platform, registered} = platformFixture();
    platform.registerPollingInterval = timer => clearInterval(timer);
    const unit = {room: 'Study', unitid: 'unit-1'} as Unit;
    platform.melviewService!.discover = async () => [{buildingid: 1, building: 'Home', units: [unit]} as Building];
    // A real MELView response carries fanstage in both payloads; this one omits
    // it from capabilities, so a five-stage ladder would be the wrong default.
    platform.melviewService!.capabilities = async () => ({halfdeg: 0} as Capabilities);
    platform.melviewService!.getStatus = async () => ({
        power: 0, setmode: WorkMode.COOL, setfan: 2, fanstage: 3,
        settemp: '21', roomtemp: '21', error: 'ok',
    } as State);

    await platform.discoverDevices();

    assert.equal(unit.capabilities!.fanstage, 3);
    assert.equal(registered.length, 1);
    // Three stages means the slider has three detents, not five.
    assert.equal(fanRotationStep(unit.capabilities), 33.3);
});
