import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {API, Logger, PlatformConfig} from 'homebridge';
import {Cookie} from 'tough-cookie';
import {AUTH_REFRESH_MARGIN_MS, cookieExpiresWithin, MelviewService, parseAuthCookie} from '../src/melviewService';

const HOUR_MS = 60 * 60 * 1000;

function silentLog(): Logger {
    const noop = () => undefined;
    return {debug: noop, info: noop, warn: noop, error: noop, log: noop, success: noop} as unknown as Logger;
}

function service(): MelviewService {
    return new MelviewService(silentLog(),
        {user: 'u@example.com', password: 'secret'} as unknown as PlatformConfig,
        {} as API);
}

function cookieExpiringIn(ms: number): Cookie {
    const expires = new Date(Date.now() + ms).toUTCString();
    return Cookie.parse(`auth=TOKEN; Expires=${expires}; Path=/`)!;
}

/** Queue responses to be returned by successive fetch calls. */
function stubFetch(responses: Response[]): { calls: { url: string; init?: RequestInit }[] } {
    const calls: { url: string; init?: RequestInit }[] = [];
    const queue = [...responses];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), init});
        const next = queue.shift();
        if (!next) {
            throw new Error('fetch called more times than the test queued responses for');
        }
        return next;
    }) as typeof fetch;
    return {calls};
}

function loginResponse(): Response {
    return new Response(JSON.stringify({id: 1, fullname: 'Test'}), {
        status: 200,
        headers: [['set-cookie', `auth=TOKEN; Expires=${new Date(Date.now() + 24 * HOUR_MS).toUTCString()}; Path=/`]],
    });
}

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

test('the auth cookie is picked out of the Set-Cookie headers', () => {
    const cookie = parseAuthCookie([
        'ASP.NET_SessionId=xyz; Path=/; HttpOnly',
        'auth=TOKEN123; Expires=Wed, 20 Aug 2036 10:00:00 GMT; Path=/',
    ]);
    assert.equal(cookie?.key, 'auth');
    assert.equal(cookie?.value, 'TOKEN123');
});

test('a missing auth cookie is reported rather than mis-parsed', () => {
    assert.equal(parseAuthCookie([]), undefined);
    assert.equal(parseAuthCookie(['other=B; Path=/']), undefined);
});

test('expiryTime is an absolute timestamp, so a fresh cookie is not treated as expiring', () => {
    // Regression: comparing expiryTime() directly against 0 made this always false,
    // so the session was never refreshed.
    assert.equal(cookieExpiresWithin(cookieExpiringIn(24 * HOUR_MS), AUTH_REFRESH_MARGIN_MS), false);
});

test('a cookie inside the refresh margin is treated as expiring', () => {
    assert.equal(cookieExpiresWithin(cookieExpiringIn(2 * 60 * 1000), AUTH_REFRESH_MARGIN_MS), true);
    assert.equal(cookieExpiresWithin(cookieExpiringIn(-1000), AUTH_REFRESH_MARGIN_MS), true);
    assert.equal(cookieExpiresWithin(undefined, AUTH_REFRESH_MARGIN_MS), true);
});

test('a session cookie with no stated expiry is not pre-emptively refreshed', () => {
    const sessionCookie = Cookie.parse('auth=TOKEN; Path=/')!;
    assert.equal(cookieExpiresWithin(sessionCookie, AUTH_REFRESH_MARGIN_MS), false);
});

test('login surfaces the HTTP status instead of a generic network error', async () => {
    stubFetch([new Response('nope', {status: 503, statusText: 'Service Unavailable'})]);
    await assert.rejects(service().login(), /HTTP 503/);
});

test('login rejects a response that carries no auth cookie', async () => {
    stubFetch([new Response(JSON.stringify({id: 1}), {status: 200})]);
    await assert.rejects(service().login(), /Unable to get auth token/);
});

test('an expired session (HTML login page under a 200) triggers one re-login and retry', async () => {
    const {calls} = stubFetch([
        loginResponse(),
        new Response('<html><body>Please log in</body></html>', {status: 200}),
        loginResponse(),
        new Response(JSON.stringify({id: 'u1', power: 1}), {status: 200}),
    ]);

    const state = await service().getStatus('u1');

    assert.equal(state.power, 1);
    assert.deepEqual(calls.map(c => c.url.split('/').pop()),
        ['login.aspx', 'unitcommand.aspx', 'login.aspx', 'unitcommand.aspx']);
});

test('a server error is surfaced as-is and not retried as an auth failure', async () => {
    const {calls} = stubFetch([
        loginResponse(),
        new Response('boom', {status: 500, statusText: 'Internal Server Error'}),
    ]);

    await assert.rejects(service().getStatus('u1'), /HTTP 500/);
    assert.equal(calls.length, 2);
});

test('requests carry the auth cookie once logged in', async () => {
    const {calls} = stubFetch([
        loginResponse(),
        new Response(JSON.stringify([]), {status: 200}),
    ]);

    await service().discover();

    const headers = calls[1].init?.headers as Record<string, string>;
    assert.equal(headers.cookie, 'auth=TOKEN');
});

test('concurrent callers share a single login', async () => {
    const {calls} = stubFetch([
        loginResponse(),
        new Response(JSON.stringify({id: 'u1', power: 1}), {status: 200}),
        new Response(JSON.stringify({id: 'u2', power: 0}), {status: 200}),
    ]);

    const s = service();
    await Promise.all([s.getStatus('u1'), s.getStatus('u2')]);

    assert.equal(calls.filter(c => c.url.endsWith('login.aspx')).length, 1);
});
