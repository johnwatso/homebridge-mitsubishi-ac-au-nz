import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCommandResponse, CommandResponse, State} from '../src/data';

function baseState(): State {
    return {
        id: 'u1',
        unitname: 'Lounge',
        userunits: 1,
        modeltype: 0,
        fanstage: 5,
        hasairdir: 0,
        hasswing: 1,
        hasauto: 1,
        power: 0,
        standby: 0,
        setmode: 3,
        automode: 0,
        setfan: 2,
        settemp: '21',
        roomtemp: '20',
        outdoortemp: '15',
        airdir: 0,
        airdirh: 0,
        sendcount: 0,
        fault: '',
        error: 'ok',
    } as State;
}

function response(partial: Partial<CommandResponse>): CommandResponse {
    return partial as CommandResponse;
}

test('applies the authoritative numeric fields from a command response', () => {
    const state = baseState();
    applyCommandResponse(state, response({
        power: 1,
        setmode: 1,
        setfan: 5,
        airdir: 7,
        settemp: '24',
    }));

    assert.equal(state.power, 1);
    assert.equal(state.setmode, 1);
    assert.equal(state.setfan, 5);
    assert.equal(state.airdir, 7);
    assert.equal(state.settemp, '24');
});

test('does not clobber existing strings with empty response values', () => {
    const state = baseState();
    applyCommandResponse(state, response({
        power: 1,
        settemp: '',
        roomtemp: '',
        outdoortemp: '',
    }));

    assert.equal(state.power, 1);
    // Empty strings in the response must not wipe the known-good readings.
    assert.equal(state.settemp, '21');
    assert.equal(state.roomtemp, '20');
    assert.equal(state.outdoortemp, '15');
});

test('preserves fields the response omits', () => {
    const state = baseState();
    applyCommandResponse(state, response({power: 1}));

    assert.equal(state.power, 1);
    assert.equal(state.setmode, 3);
    assert.equal(state.setfan, 2);
});

test('power 0 is applied (falsy value is not skipped)', () => {
    const state = baseState();
    state.power = 1;
    applyCommandResponse(state, response({power: 0}));
    assert.equal(state.power, 0);
});
