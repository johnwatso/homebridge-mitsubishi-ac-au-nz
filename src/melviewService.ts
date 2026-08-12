import {API, Logger, PlatformConfig} from 'homebridge';
import {Cookie} from 'tough-cookie';
import {Account, Building, Capabilities, CommandResponse, State} from './data';
import {Command} from './melviewCommand';

const URL = 'https://api.melview.net/api/';
const APP_VERSION = '5.3.1348';
const AUTH_SERVICE = 'login.aspx';
const ROOMS_SERVICE = 'rooms.aspx';
const COMMAND_SERVICE = 'unitcommand.aspx';
const CAPABILITIES_SERVICE = 'unitcapabilities.aspx';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:54.0) Gecko/20100101 Firefox/54.0';

/** Cloud calls give up rather than leaving a poll hanging forever. */
const REQUEST_TIMEOUT_MS = 15000;
/** The unit's LAN endpoint is a best-effort shortcut, so fail fast when it isn't reachable. */
const LOCAL_TIMEOUT_MS = 2000;
/** Re-login this long before the cookie actually expires, so a poll never races the expiry. */
export const AUTH_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Raised when MELView refuses the session cookie. Callers re-login once and
 * retry, since an expired cookie is the common cause and it is invisible until
 * a request comes back wrong.
 */
class SessionRejectedError extends Error {}

/**
 * Pick the `auth` cookie out of the response's Set-Cookie headers.
 *
 * Exported for testing. Each header must be parsed individually - Set-Cookie
 * values contain commas (in `Expires`), so the headers can neither be joined
 * nor split reliably.
 */
export function parseAuthCookie(setCookieHeaders: string[]): Cookie | undefined {
  for (const header of setCookieHeaders) {
    const cookie = Cookie.parse(header);
    if (cookie?.key === 'auth' && cookie.value) {
      return cookie;
    }
  }
  return undefined;
}

/**
 * Whether `cookie` is missing, already expired, or expires within `marginMs`.
 *
 * Exported for testing. Note `Cookie.expiryTime()` returns an absolute
 * timestamp (ms since the epoch), not a remaining duration, and returns
 * `Infinity` for a cookie with no stated expiry.
 */
export function cookieExpiresWithin(cookie: Cookie | undefined, marginMs: number, now: number = Date.now()): boolean {
  if (!cookie) {
    return true;
  }
  const expiresAt = cookie.expiryTime(now);
  if (expiresAt === undefined) {
    return true;
  }
  if (!Number.isFinite(expiresAt)) {
    // Session cookie: no expiry to anticipate, so rely on retry-after-rejection.
    return false;
  }
  return expiresAt - now <= marginMs;
}

/** Fetch rejections are otherwise opaque ('fetch failed'); name the cause. */
function describeRequestFailure(e: unknown): string {
  if (e instanceof Error) {
    return e.name === 'TimeoutError' || e.name === 'AbortError' ? 'the request timed out' : e.message;
  }
  return String(e);
}

/** A short, log-safe excerpt of an unexpected (usually HTML) response body. */
function excerpt(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 120)}...` : collapsed;
}

export class MelviewService {
    private auth?: Cookie;
    private loginInFlight?: Promise<Account>;

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
      this.log.debug('Service Instantiated!');
    }

    /**
     * Login to Melview API system.
     */
    public async login(): Promise<Account> {
      const response = await this.post(URL + AUTH_SERVICE, {
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: JSON.stringify({
          user: this.config.user,
          pass: this.config.password,
          appversion: APP_VERSION,
        }),
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      if (response.status !== 200) {
        throw new Error(`Failed to login - MELView returned HTTP ${response.status} ${response.statusText}.`);
      }

      const body = await response.text();
      this.auth = parseAuthCookie(response.headers.getSetCookie());
      if (!this.auth) {
        throw new Error('Unable to get auth token from MelView. You may need to reset your password with Mitsubishi');
      }

      try {
        return JSON.parse(body) as Account;
      } catch {
        throw new Error(`Failed to parse the login response from Melview: ${excerpt(body)}`);
      }
    }

    /**
     * Ensure a valid auth token before issuing a request. Awaits a (re)login
     * when the token is missing or about to expire, and de-dupes concurrent
     * callers onto a single in-flight login so many polling units don't trigger
     * a login stampede.
     */
    private async ensureAuth(): Promise<void> {
      if (!this.authWillExpire()) {
        return;
      }
      if (!this.loginInFlight) {
        this.loginInFlight = this.login().finally(() => {
          this.loginInFlight = undefined;
        });
      }
      await this.loginInFlight;
    }

    /**
     * Queries the entire inventory of accessories listed in Melview for the account.
     */
    public async discover(): Promise<Building[] | undefined> {
      return this.authedRequest<Building[]>(ROOMS_SERVICE);
    }

    /**
     * Query the capabilities of a given device.
     * @param unitID is the unit identifier
     */
    public async capabilities(unitID: string): Promise<Capabilities> {
      return this.authedRequest<Capabilities>(CAPABILITIES_SERVICE, {unitid: unitID});
    }

    /**
     * Issue a command to the melview platform.
     * @param command is the command to be executed.
     * @param commandChain any additional commands to be executed in chain.
     */
    public async command(command : Command, ...commandChain: Command[]): Promise<CommandResponse> {
      const allComms = [command, ...commandChain].map(c => c.execute()).join(',');
      const payload = {
        unitid: command.getUnitID(),
        v: 2,
        commands: allComms,
        lc: 1,
      };
      this.log.debug('cmd:', JSON.stringify(payload));

      const rBody = await this.authedRequest<CommandResponse>(COMMAND_SERVICE, payload);
      if (rBody.error === 'ok' && rBody.lc && rBody.lc.length > 0) {
        this.dispatchLocalCommand(command, rBody.lc);
      }
      return rBody;
    }

    /**
     * Get the current state of the unit.
     * @param unitID is the unit identifier
     */
    public async getStatus(unitID: string): Promise<State> {
      return this.authedRequest<State>(COMMAND_SERVICE, {unitid: unitID});
    }

    public authWillExpire(): boolean {
      try {
        return cookieExpiresWithin(this.auth, AUTH_REFRESH_MARGIN_MS);
      } catch (e) {
        this.log.error(String(e));
        return true;
      }
    }

    /**
     * Send an authenticated request, re-logging in and retrying once if MELView
     * rejects the session. Expired cookies are only detectable from the reply -
     * the API answers with a login page rather than a 401 - so the retry is what
     * keeps a long-running bridge alive.
     */
    private async authedRequest<T>(service: string, payload?: Record<string, unknown>): Promise<T> {
      await this.ensureAuth();
      try {
        return await this.postJson<T>(service, payload);
      } catch (e) {
        if (!(e instanceof SessionRejectedError)) {
          throw e;
        }
        this.log.debug('MELView rejected the session for', service, '- re-authenticating and retrying once.');
        this.auth = undefined;
        await this.ensureAuth();
        return this.postJson<T>(service, payload);
      }
    }

    private async postJson<T>(service: string, payload?: Record<string, unknown>): Promise<T> {
      const response = await this.post(URL + service, {
        headers: this.populateHeaders(),
        body: payload ? JSON.stringify(payload) : undefined,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      if (response.status === 401 || response.status === 403) {
        throw new SessionRejectedError(`MELView rejected the session (HTTP ${response.status}).`);
      }
      if (!response.ok) {
        throw new Error(`MELView ${service} failed with HTTP ${response.status} ${response.statusText}.`);
      }

      const body = await response.text();
      try {
        return JSON.parse(body) as T;
      } catch {
        // An expired session yields an HTML login page under a 200, so treat any
        // non-JSON body as a rejected session and let the caller retry once.
        throw new SessionRejectedError(`MELView ${service} returned a non-JSON body: ${excerpt(body)}`);
      }
    }

    /**
     * Nudge the unit over the LAN so it applies the command without waiting for
     * its own cloud poll. Entirely optional: the cloud command has already been
     * accepted by the time this runs.
     */
    private dispatchLocalCommand(command: Command, key: string): void {
      const url = command.getLocalCommandURL();
      if (!url) {
        this.log.debug('No LAN address known for unit', command.getUnitID(), '- skipping the direct request.');
        return;
      }
      this.post(url, {
        headers: {'Content-Type': 'text/xml'},
        body: command.getLocalCommandBody(key),
        timeoutMs: LOCAL_TIMEOUT_MS,
      })
        .then(r => r.text())
        .then(v => this.log.debug('Successfully processed local request:', v))
        .catch(e => this.log.warn('Unable to access unit via direct LAN interface:', describeRequestFailure(e)));
    }

    private async post(url: string, init: {
        headers: Record<string, string>;
        body?: string;
        timeoutMs: number;
    }): Promise<Response> {
      try {
        return await fetch(url, {
          method: 'POST',
          headers: init.headers,
          body: init.body,
          signal: AbortSignal.timeout(init.timeoutMs),
        });
      } catch (e) {
        throw new Error(`Request to ${url} failed - ${describeRequestFailure(e)}.`, {cause: e});
      }
    }

    private populateHeaders() {
      return {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'cookie': 'auth=' + this.auth!.value,
      };
    }
}
