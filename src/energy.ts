import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {EnergyReport} from './data';

/** One hour of MELView-reported usage, keyed `YYYY-MM-DD HH` in the unit's local time. */
export interface HourlyUsage {
    hour: string;
    wh: number;
}

/**
 * A running energy total built from MELView's hourly buckets.
 *
 * MELView only reports per-hour usage, while Matter's cumulativeEnergyImported
 * must only ever grow. Recent hours stay in `hours` so late revisions to a
 * bucket are picked up; hours older than the retention window are folded into
 * `settledWh` and never revisited.
 */
export interface EnergyLedger {
    settledWh: number;
    hours: Record<string, number>;
}

/** Hours kept revisable - comfortably wider than the 48-row window we request. */
export const LEDGER_RETAIN_HOURS = 72;

const pad2 = (n: number) => String(n).padStart(2, '0');

export function emptyLedger(): EnergyLedger {
    return {settledWh: 0, hours: {}};
}

/** Ledger key for the hour containing `date` (local time). */
export function hourKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}`;
}

/** energyreport.aspx `startdate`, formatted the way the Wi-Fi Control app sends it (`yyyy-MM-d`). */
export function energyStartDate(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${date.getDate()}`;
}

/**
 * The `startdate` to poll with. MELView returns `rows` hourly buckets counting
 * forward from the start of that day, so starting yesterday with 48 rows covers
 * yesterday and today - late readings for yesterday's last hours still land
 * after midnight.
 */
export function energyPollStartDate(now: Date): string {
    return energyStartDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

/**
 * Pull hourly usage out of an energyreport.aspx response. Entries carry a
 * `date` like `2026-09-14 13:00:00` and `used` in Wh; anything malformed is
 * skipped rather than trusted.
 */
export function parseHourlyUsage(report: EnergyReport | undefined): HourlyUsage[] {
    const usage: HourlyUsage[] = [];
    for (const entry of report?.energy ?? []) {
        const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2})/.exec(String(entry?.date ?? ''));
        const wh = Number(entry?.used);
        if (!match || !Number.isFinite(wh) || wh < 0) {
            continue;
        }
        const [, year, month, day, hour] = match;
        usage.push({hour: `${year}-${pad2(Number(month))}-${pad2(Number(day))} ${pad2(Number(hour))}`, wh});
    }
    return usage;
}

/**
 * Merge a fresh batch of hourly usage into the ledger and settle hours that
 * have aged out of the retention window. A bucket only ever grows: MELView
 * counts usage within an hour upwards, so a smaller value is a partial reply,
 * not a correction.
 */
export function applyHourlyUsage(
    ledger: EnergyLedger,
    usage: HourlyUsage[],
    now: Date = new Date(),
    retainHours: number = LEDGER_RETAIN_HOURS,
): EnergyLedger {
    const hours = {...ledger.hours};
    for (const {hour, wh} of usage) {
        hours[hour] = Math.max(hours[hour] ?? 0, wh);
    }

    const cutoff = hourKey(new Date(now.getTime() - retainHours * 3600 * 1000));
    let settledWh = ledger.settledWh;
    for (const hour of Object.keys(hours)) {
        // Zero-padded keys sort chronologically as strings.
        if (hour < cutoff) {
            settledWh += hours[hour];
            delete hours[hour];
        }
    }
    return {settledWh, hours};
}

/** Total Wh the ledger has seen. */
export function cumulativeWh(ledger: EnergyLedger): number {
    return Object.values(ledger.hours).reduce((sum, wh) => sum + wh, ledger.settledWh);
}

/** Persists one unit's ledger as JSON so the cumulative total survives restarts. */
export class EnergyLedgerStore {
    private readonly file: string;

    constructor(storageDir: string, unitid: string) {
        this.file = path.join(storageDir, `energy-${unitid.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
    }

    public load(): EnergyLedger | undefined {
        try {
            const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<EnergyLedger>;
            if (Number.isFinite(data.settledWh) && data.hours && typeof data.hours === 'object') {
                return {settledWh: data.settledWh!, hours: data.hours};
            }
        } catch {
            // Missing or unreadable - start a fresh ledger.
        }
        return undefined;
    }

    public save(ledger: EnergyLedger): void {
        mkdirSync(path.dirname(this.file), {recursive: true});
        // Write then rename, so a crash mid-write can't truncate the file - that
        // would reset the total and make Home's cumulative reading go backwards.
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify(ledger));
        renameSync(tmp, this.file);
    }
}
