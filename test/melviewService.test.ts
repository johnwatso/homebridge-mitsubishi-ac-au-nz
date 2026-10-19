import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {API, Logger, PlatformConfig} from 'homebridge';
import {Cookie} from 'tough-cookie';
import {AUTH_REFRESH_MARGIN_MS, cookieExpiresWithin, MelviewService, parseAuthCookie} from '../src/melviewService';
import {Command} from '../src/melviewCommand';

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

function command(): Command {
    return {
        execute: () => 'PW1',
        apply: () => undefined,
        getUnitID: () => 'u1',
        getLocalCommandURL: () => undefined,
        getLocalCommandBody: () => '<ESV>TOKEN</ESV>',
    };
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

test('Max-Age expires relative to cookie creation, including immediate expiry', () => {
    const cookie = Cookie.parse('auth=TOKEN; Max-Age=600')!;
    const created = cookie.creation!.getTime();
    assert.equal(cookieExpiresWithin(cookie, AUTH_REFRESH_MARGIN_MS, created), false);
    assert.equal(cookieExpiresWithin(cookie, AUTH_REFRESH_MARGIN_MS, created + 360_000), true);
    assert.equal(cookieExpiresWithin(Cookie.parse('auth=TOKEN; Max-Age=0')!, 0), true);
});

test('login surfaces the HTTP status instead of a generic network error', async () => {
    stubFetch([new Response('nope', {status: 503, statusText: 'Service Unavailable'})]);
    await assert.rejects(service().login(), /HTTP 503/);
});

test('login rejects a response that carries no auth cookie', async () => {
    stubFetch([new Response(JSON.stringify({id: 1}), {status: 200})]);
    await assert.rejects(service().login(), /Unable to get auth token/);
});

test('a malformed login response does not retain its auth cookie', async () => {
    const malformedLogin = new Response('<html>broken</html>', {
        status: 200,
        headers: [['set-cookie', `auth=BAD; Expires=${new Date(Date.now() + 24 * HOUR_MS).toUTCString()}; Path=/`]],
    });
    const {calls} = stubFetch([
        malformedLogin,
        loginResponse(),
        new Response(JSON.stringify({id: 'u1', power: 1, setmode: 3, setfan: 1, settemp: '21', roomtemp: '20'}), {status: 200}),
    ]);
    const s = service();

    await assert.rejects(s.login(), /Failed to parse/);
    assert.equal((await s.getStatus('u1')).power, 1);
    assert.equal(calls.filter(call => call.url.endsWith('login.aspx')).length, 2);
});

test('an expired session (HTML login page under a 200) triggers one re-login and retry', async () => {
    const {calls} = stubFetch([
        loginResponse(),
        new Response('<html><body>Please log in</body></html>', {status: 200}),
        loginResponse(),
        new Response(JSON.stringify({id: 'u1', power: 1, setmode: 3, setfan: 1, settemp: '21', roomtemp: '20'}), {status: 200}),
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
        new Response(JSON.stringify({id: 'u1', power: 1, setmode: 3, setfan: 1, settemp: '21', roomtemp: '20'}), {status: 200}),
        new Response(JSON.stringify({id: 'u2', power: 0, setmode: 3, setfan: 1, settemp: '21', roomtemp: '20'}), {status: 200}),
    ]);

    const s = service();
    await Promise.all([s.getStatus('u1'), s.getStatus('u2')]);

    assert.equal(calls.filter(c => c.url.endsWith('login.aspx')).length, 1);
});

test('a rejected command is surfaced instead of being treated as accepted', async () => {
    stubFetch([
        loginResponse(),
        new Response(JSON.stringify({error: 'unit offline', lc: ''}), {status: 200}),
    ]);

    await assert.rejects(service().command(command()), /rejected command.*unit offline/);
});

test('malformed JSON status cannot replace a healthy cached state', async () => {
    for (const body of [null, {}, {error: 'unit offline'}, {power: 1, setmode: 3},
        {power: 1, setmode: 3, setfan: 1, settemp: '', roomtemp: '20'}]) {
        stubFetch([loginResponse(), new Response(JSON.stringify(body))]);
        await assert.rejects(service().getStatus('u1'), /invalid status/);
    }
});

test('malformed discovery and capability responses fail before accessory setup', async () => {
    for (const body of [null, {}, [{building: 'Home'}], [{units: [{room: 'Study'}]}]]) {
        stubFetch([loginResponse(), new Response(JSON.stringify(body))]);
        await assert.rejects(service().discover(), /invalid unit inventory/);
    }
    stubFetch([loginResponse(), new Response(JSON.stringify({error: 'offline'}))]);
    await assert.rejects(service().capabilities('u1'), /invalid capabilities/);
});

test('a JSON null login response does not retain a cookie', async () => {
    const badLogin = new Response('null', {headers: {'set-cookie': 'auth=BAD; Path=/'}});
    const {calls} = stubFetch([badLogin, loginResponse(), new Response('[]')]);
    const s = service();
    await assert.rejects(s.discover(), /Failed to parse/);
    assert.deepEqual(await s.discover(), []);
    assert.equal(calls.filter(call => call.url.endsWith('login.aspx')).length, 2);
});

test('late rejection of an old cookie reuses the new session', async () => {
    let rejectOldRequest!: (response: Response) => void;
    let logins = 0;
    let requests = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
        if (String(url).endsWith('login.aspx')) {
            logins++;
            return loginResponse();
        }
        requests++;
        if (requests === 1) {
return new Response('expired', {status: 401});
}
        if (requests === 2) {
return new Promise<Response>(resolve => {
    rejectOldRequest = resolve;
});
}
        return new Response('[]');
    }) as typeof fetch;
    const s = service();
    await s.login();
    const first = s.discover();
    const second = s.discover();
    await first;
    rejectOldRequest(new Response('expired', {status: 401}));
    await second;
    assert.equal(logins, 2);
});

test('temperatures reported as numbers rather than strings are accepted', async () => {
    stubFetch([loginResponse(),
        new Response(JSON.stringify({id: 'u1', power: 1, setmode: 3, setfan: 1, settemp: 21, roomtemp: 20.5}))]);
    const state = await service().getStatus('u1');
    assert.equal(Number(state.settemp), 21);
    assert.equal(Number(state.roomtemp), 20.5);
});

test('capabilities missing an optional field are kept; an error envelope is not', async () => {
    stubFetch([loginResponse(), new Response(JSON.stringify({id: 'u1', unitname: 'Study', halfdeg: 1}))]);
    assert.equal((await service().capabilities('u1')).fanstage, undefined);
    stubFetch([loginResponse(), new Response(JSON.stringify({error: 'offline'}))]);
    await assert.rejects(service().capabilities('u1'), /invalid capabilities/);
});
