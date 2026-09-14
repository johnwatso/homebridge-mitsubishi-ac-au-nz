import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoveryRetryDelayMs} from '../src/platform';

test('discovery retries back off from 30s to a 10 minute cap', () => {
    assert.equal(discoveryRetryDelayMs(0), 30_000);
    assert.equal(discoveryRetryDelayMs(1), 60_000);
    assert.equal(discoveryRetryDelayMs(4), 480_000);
    assert.equal(discoveryRetryDelayMs(5), 600_000);
    assert.equal(discoveryRetryDelayMs(50), 600_000);
    assert.equal(discoveryRetryDelayMs(-1), 30_000);
});
