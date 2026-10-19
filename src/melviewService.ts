import {API, Logger, PlatformConfig} from 'homebridge';
import {Cookie} from 'tough-cookie';
import {Account, Building, Capabilities, CommandResponse, EnergyReport, State} from './data';
import {Command} from './melviewCommand';

const URL = 'https://api.melview.net/api/';
const APP_VERSION = '5.3.1348';
const AUTH_SERVICE = 'login.aspx';
const ROOMS_SERVICE = 'rooms.aspx';
const COMMAND_SERVICE = 'unitcommand.aspx';
const CAPABILITIES_SERVICE = 'unitcapabilities.aspx';
const ENERGY_SERVICE = 'energyreport.aspx';
/** API version the Wi-Fi Control app sends with energy report requests. */
const ENERGY_API_VERSION = 5;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:54.0) Gecko/20100101 Firefox/54.0';

/** Cloud calls give up rather than leaving a poll hanging forever. */
const REQUEST_TIMEOUT_MS = 15000;
/** The unit's LAN endpoint is a best-effort shortcut, so fail fast when it isn't reachable. */
const LOCAL_TIMEOUT_MS = 2000;
/** Re-login this long before the cookie actually expires, so a poll never races the expiry. */
export const AUTH_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/**
 * How long to leave delivery to MELView after a LAN hop has failed, rather than
 * paying a failed local request plus a re-send on every command.
 */
export const LOCAL_DELIVERY_COOLDOWN_MS = 15 * 60 * 1000;

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
  // Max-Age is relative to creation, not the time we check the cookie. Passing
  // a timestamp here also throws in tough-cookie 4, which expects a Date.
  const expiresAt = cookie.expiryTime();
  if (expiresAt === undefined) {
    return true;
  }
  if (expiresAt === Infinity) {
    // Session cookie: no expiry to anticipate, so rely on retry-after-rejection.
    return false;
  }
  return expiresAt - now <= marginMs;
}

/** Fetch rejections are otherwise opaque ('fetch failed'); name the cause. */
function describeRequestFailure(e: unknown): string {
  if (!(e instanceof Error)) {
    return String(e);
  }
  if (e.name === 'TimeoutError' || e.name === 'AbortError') {
    return 'the request timed out';
  }
  // undici keeps the useful part out of the message it throws ('fetch failed',
  // 'terminated') and nests it as a cause, so walk the chain. Causes already
  // named in the message are skipped, since `post` describes the error it wraps.
  const causes: string[] = [];
  let cause: unknown = e.cause;
  while (cause instanceof Error && causes.length < 3) {
    const detail = (cause as NodeJS.ErrnoException).code ?? cause.message;
    if (detail && !e.message.includes(detail) && !causes.includes(detail)) {
      causes.push(detail);
    }
    cause = cause.cause;
  }
  return causes.length > 0 ? `${e.message} (${causes.join(': ')})` : e.message;
}

/** A short, log-safe excerpt of an unexpected (usually HTML) response body. */
function excerpt(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 120)}...` : collapsed;
}

/**
 * Read a body, keeping whatever arrived when the connection dies mid-stream.
 * The unit's reply is the only evidence of how it took a local command, so a
 * truncated read must not discard it - `Response.text()` throws it away.
 */
async function readBodyBestEffort(response: Response): Promise<{ body: string; truncated?: string }> {
  const reader = response.body?.getReader();
  if (!reader) {
    return {body: ''};
  }
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }
  } catch (e) {
    return {body: Buffer.concat(chunks).toString('utf8'), truncated: describeRequestFailure(e)};
  }
  return {body: Buffer.concat(chunks).toString('utf8')};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * MELView reports temperatures as strings, but the `State` consumers accept
 * numbers too, so validation must not be the strictest link in the chain.
 */
function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

export class MelviewService {
    private auth?: Cookie;
    private loginInFlight?: Promise<Account>;
    /** Unit ID -> when local delivery may be attempted again. */
    private localDeliveryRetryAt = new Map<string, number>();

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
      const auth = parseAuthCookie(response.headers.getSetCookie());
      if (!auth) {
        throw new Error('Unable to get auth token from MelView. You may need to reset your password with Mitsubishi');
      }

      try {
        const account = JSON.parse(body) as Account;
        if (!isRecord(account) || !Number.isFinite(account.id)) {
          throw new Error('Invalid account response');
        }
        // Do not retain a cookie from a malformed login response. Keeping it
        // would make the next discovery skip login and fail less clearly.
        this.auth = auth;
        return account;
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
      const buildings = await this.authedRequest<Building[]>(ROOMS_SERVICE);
      // Validate the whole inventory before registration or stale removal.
      if (!Array.isArray(buildings) || !buildings.every(b => isRecord(b) && Array.isArray(b.units) &&
        b.units.every(unit => isRecord(unit) && typeof unit.unitid === 'string' && unit.unitid.length > 0 &&
          typeof unit.room === 'string'))) {
        throw new Error('MELView returned an invalid unit inventory.');
      }
      return buildings;
    }

    /**
     * Query the capabilities of a given device.
     * @param unitID is the unit identifier
     */
    public async capabilities(unitID: string): Promise<Capabilities> {
      const capabilities = await this.authedRequest<Capabilities>(CAPABILITIES_SERVICE, {unitid: unitID});
      // Reject MELView's error envelope, but not an otherwise valid payload
      // with fields missing: a missing fanstage is recoverable from the status
      // response, so it must not keep the unit out of Home entirely.
      if (!isRecord(capabilities) ||
        (capabilities.error !== undefined && capabilities.error !== 'ok')) {
        throw new Error(`MELView returned invalid capabilities for unit ${unitID}.`);
      }
      return capabilities;
    }

    /**
     * Issue a command to the melview platform.
     * @param command is the command to be executed.
     * @param commandChain any additional commands to be executed in chain.
     */
    public async command(command : Command, ...commandChain: Command[]): Promise<CommandResponse> {
      const allComms = [command, ...commandChain].map(c => c.execute()).join(',');
      const unitID = command.getUnitID();

      // Only our own request for a token puts us on the hook for delivery; a
      // token MELView volunteers is not a transfer of responsibility.
      const handedLocalDelivery = this.localDeliveryUsable(command);
      const rBody = await this.postCommand(unitID, allComms, handedLocalDelivery);
      if (handedLocalDelivery && rBody.lc && rBody.lc.length > 0 &&
        !await this.dispatchLocalCommand(command, rBody.lc)) {
        // MELView handed delivery to us and the LAN hop did not complete, so
        // the unit never saw this command. Leave the following ones to MELView
        // and re-send this one for it to deliver on the unit's own poll.
        this.localDeliveryRetryAt.set(unitID, Date.now() + LOCAL_DELIVERY_COOLDOWN_MS);
        this.log.warn('Could not hand the command for unit', unitID,
          'to the unit over the LAN - re-sending it for MELView to deliver.',
          `Local commands pause for ${Math.round(LOCAL_DELIVERY_COOLDOWN_MS / 60000)} minutes.`);
        return this.postCommand(unitID, allComms, false);
      }
      return rBody;
    }

    /**
     * Send one command set to MELView.
     *
     * `lc` is not a hint: asking for a local command token makes the LAN hop
     * responsible for getting the command to the unit, so it is only requested
     * when that hop is usable. Without it MELView delivers on the unit's own
     * poll - slower, but it arrives.
     */
    private async postCommand(unitID: string, commands: string, requestLocalToken: boolean): Promise<CommandResponse> {
      const payload: Record<string, unknown> = {unitid: unitID, v: 2, commands};
      if (requestLocalToken) {
        payload.lc = 1;
      }
      this.log.debug('cmd:', JSON.stringify(payload));

      const rBody = await this.authedRequest<CommandResponse>(COMMAND_SERVICE, payload);
      if (rBody.error !== 'ok') {
        throw new Error(`MELView rejected command for unit ${unitID}: ${rBody.error || 'unknown error'}.`);
      }
      return rBody;
    }

    /** Whether the LAN hop is worth asking MELView to rely on for this unit. */
    private localDeliveryUsable(command: Command): boolean {
      if (!command.getLocalCommandURL()) {
        return false;
      }
      const retryAt = this.localDeliveryRetryAt.get(command.getUnitID());
      return retryAt === undefined || Date.now() >= retryAt;
    }

    /**
     * Get the current state of the unit.
     * @param unitID is the unit identifier
     */
    public async getStatus(unitID: string): Promise<State> {
      const state = await this.authedRequest<State>(COMMAND_SERVICE, {unitid: unitID});
      if (!isRecord(state) || (state.power !== 0 && state.power !== 1) ||
        !Number.isFinite(state.setmode) || !Number.isFinite(state.setfan) ||
        !isNumeric(state.settemp) || !isNumeric(state.roomtemp)) {
        throw new Error(`MELView returned invalid status for unit ${unitID}.`);
      }
      return state;
    }

    /**
     * Fetch hourly energy usage, as the Wi-Fi Control app's Energy page does.
     * Only meaningful for units whose capabilities report `hasenergy`.
     * @param unitID is the unit identifier
     * @param startDate is the first report day, formatted `yyyy-MM-d`
     * @param rows is how many hourly buckets to return, counting forward from that day's midnight
     */
    public async energyReport(unitID: string, startDate: string, rows = 48): Promise<EnergyReport> {
      return this.authedRequest<EnergyReport>(ENERGY_SERVICE, {
        unitid: unitID,
        period: 'D',
        startdate: startDate,
        rows,
        v: ENERGY_API_VERSION,
      });
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
      const requestAuth = this.auth;
      try {
        return await this.postJson<T>(service, payload);
      } catch (e) {
        if (!(e instanceof SessionRejectedError)) {
          throw e;
        }
        this.log.debug('MELView rejected the session for', service, '- re-authenticating and retrying once.');
        // Another unit may already have replaced the rejected session while
        // this request was in flight. Do not invalidate that fresh login.
        if (this.auth === requestAuth) {
          this.auth = undefined;
        }
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
     * Hand the command to the unit over the LAN, using the token MELView issued.
     *
     * This is how the command reaches the unit once `lc` was requested, not a
     * mere accelerator, so the caller needs to know whether it worked.
     *
     * @returns whether the unit took the command.
     */
    private async dispatchLocalCommand(command: Command, key: string): Promise<boolean> {
      const url = command.getLocalCommandURL();
      if (!url) {
        this.log.debug('No LAN address known for unit', command.getUnitID(), '- skipping the direct request.');
        return false;
      }
      try {
        const response = await this.post(url, {
          headers: {'Content-Type': 'text/xml'},
          body: command.getLocalCommandBody(key),
          timeoutMs: LOCAL_TIMEOUT_MS,
        });
        const {body, truncated} = await readBodyBestEffort(response);
        if (!response.ok) {
          throw new Error(`the unit returned HTTP ${response.status} ${response.statusText}` +
            `${body ? `: ${excerpt(body)}` : ''}`);
        }
        // The Wi-Fi adapter hangs up as soon as it has answered, often before
        // finishing the body it announced, which undici reports as 'terminated'.
        // The status line is already proof the unit took the command, so a reply
        // we cannot finish reading is not a failure.
        if (truncated) {
          this.log.debug('Unit', command.getUnitID(), 'cut the LAN reply short:', truncated,
            '- it had sent:', excerpt(body) || '(nothing)');
        } else {
          this.log.debug('Successfully processed local request:', body);
        }
        return true;
      } catch (e) {
        this.log.warn('Unable to access unit', command.getUnitID(),
          'via direct LAN interface:', describeRequestFailure(e));
        return false;
      }
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
