import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
    applyHourlyUsage,
    cumulativeWh,
    emptyLedger,
    energyPollStartDate,
    energyStartDate,
    EnergyLedgerStore,
    hourKey,
    parseHourlyUsage,
} from '../src/energy';
import {EnergyReport} from '../src/data';

test('parses hourly buckets and normalises the hour key', () => {
    const report = {
        energy: [
            {date: '2026-09-14 13:00:00', used: 400},
            {date: '2026-9-4 7:00:00', used: 0},
        ],
    } as EnergyReport;
    assert.deepEqual(parseHourlyUsage(report), [
        {hour: '2026-09-14 13', wh: 400},
        {hour: '2026-09-04 07', wh: 0},
    ]);
});

test('skips malformed entries and tolerates a missing energy array', () => {
    const report = {
        energy: [
            {date: 'not a date', used: 100},
            {date: '2026-09-14 13:00:00', used: -5},
            {date: '2026-09-14 14:00:00', used: 'abc'},
            {used: 100},
        ],
    } as unknown as EnergyReport;
    assert.deepEqual(parseHourlyUsage(report), []);
    assert.deepEqual(parseHourlyUsage({} as EnergyReport), []);
    assert.deepEqual(parseHourlyUsage(undefined), []);
});

test('accumulates hours and keeps the larger value when a bucket is re-reported', () => {
    const now = new Date(2026, 8, 14, 15);
    let ledger = applyHourlyUsage(emptyLedger(), [
        {hour: '2026-09-14 13', wh: 400},
        {hour: '2026-09-14 14', wh: 100},
    ], now);
    assert.equal(cumulativeWh(ledger), 500);

    // The current hour grows; a short/partial reply must not shrink a bucket.
    ledger = applyHourlyUsage(ledger, [
        {hour: '2026-09-14 13', wh: 300},
        {hour: '2026-09-14 14', wh: 600},
    ], now);
    assert.equal(cumulativeWh(ledger), 1000);
});

test('settles aged-out hours without losing or double-counting them', () => {
    let ledger = applyHourlyUsage(emptyLedger(), [
        {hour: '2026-09-10 01', wh: 700},
        {hour: '2026-09-14 13', wh: 400},
    ], new Date(2026, 8, 14, 15));
    assert.equal(ledger.settledWh, 700);
    assert.deepEqual(Object.keys(ledger.hours), ['2026-09-14 13']);
    assert.equal(cumulativeWh(ledger), 1100);

    // Re-reporting a settled hour is ignored once it has left the window.
    ledger = applyHourlyUsage(ledger, [], new Date(2026, 8, 20, 0));
    assert.equal(ledger.settledWh, 1100);
    assert.deepEqual(ledger.hours, {});
    assert.equal(cumulativeWh(ledger), 1100);
});

test('the cumulative total never decreases across updates', () => {
    let ledger = emptyLedger();
    let last = 0;
    const start = new Date(2026, 8, 1, 0).getTime();
    for (let h = 0; h < 24 * 7; h++) {
        const now = new Date(start + h * 3600 * 1000);
        ledger = applyHourlyUsage(ledger, [{hour: hourKey(now), wh: (h * 37) % 500}], now);
        const total = cumulativeWh(ledger);
        assert.ok(total >= last, `total dropped at hour ${h}`);
        last = total;
    }
});

test('formats keys and start dates like the Wi-Fi Control app', () => {
    const date = new Date(2026, 8, 4, 7, 30);
    assert.equal(hourKey(date), '2026-09-04 07');
    assert.equal(energyStartDate(date), '2026-09-4');
});

test('polls from yesterday so the 48 forward rows cover yesterday and today', () => {
    assert.equal(energyPollStartDate(new Date(2026, 8, 15, 0, 5)), '2026-09-14');
    assert.equal(energyPollStartDate(new Date(2026, 0, 1, 12)), '2025-12-31');
    assert.equal(energyPollStartDate(new Date(2026, 2, 1, 12)), '2026-02-28');
});

test('parses a live MELView bucket', () => {
    // Shape captured from energyreport.aspx on 2026-09-15.
    const report = {
        timezone: 'New Zealand Standard Time',
        offset: 720,
        energy: [{
            date: '2026-09-15 01:00:00', used: 0, heating: 0, cooling: 0, auto: 0, autoheat: 0,
            autcool: 0, lost: 0, other: 0, settemp: 23, power: 0,
        }],
    } as EnergyReport;
    assert.deepEqual(parseHourlyUsage(report), [{hour: '2026-09-15 01', wh: 0}]);
});

test('the ledger store round-trips and ignores a missing file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mitsubishi-energy-'));
    const store = new EnergyLedgerStore(dir, 'unit/1');
    assert.equal(store.load(), undefined);
    const ledger = {settledWh: 1200, hours: {'2026-09-14 13': 400}};
    store.save(ledger);
    assert.deepEqual(store.load(), ledger);
});
