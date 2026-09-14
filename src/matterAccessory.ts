import path from 'node:path';

import {FanControlState, MatterAccessory, ThermostatState} from 'homebridge';

import {MelviewMitsubishiHomebridgePlatform} from './platform';
import {Range, State, Unit, WorkMode} from './data';
import {applyCommandResponse} from './data';
import {Command, CommandFanCode, CommandPower, CommandTemperature, CommandWorkMode} from './melviewCommand';
import {
    applyHourlyUsage,
    cumulativeWh,
    emptyLedger,
    EnergyLedger,
    EnergyLedgerStore,
    energyPollStartDate,
    parseHourlyUsage,
} from './energy';
import {
    clampToRange,
    controlSequenceFor,
    fanCodeToFanMode,
    fanCodeToPercent,
    fanModeSequenceFor,
    FanMode,
    fromCentiDegrees,
    ModeSupport,
    modeSupportFor,
    occupiedSetpoints,
    percentToFanCode,
    SetpointLimits,
    systemModeToCommand,
    toCentiDegrees,
    workModeToRunningMode,
    workModeToSystemMode,
} from './matterMapping';

const OUTDOOR_PLAUSIBLE_MIN = -40;
const OUTDOOR_PLAUSIBLE_MAX = 50;

// Fallback setpoint ranges (°C) if MELView doesn't report them.
const DEFAULT_COOL_RANGE: Range = {min: 16, max: 31};
const DEFAULT_HEAT_RANGE: Range = {min: 10, max: 31};

/**
 * Owns one Mitsubishi unit's Matter representation: it builds the Matter
 * accessory descriptors (RoomAirConditioner + optional outdoor TemperatureSensor),
 * wires Home->device command handlers, and pushes device->Home state from the
 * MELView poll. Replaces the previous HAP service layer.
 */
export class MelviewMatterAccessory {
    public readonly acUuid: string;
    public readonly outdoorUuid?: string;
    private readonly modeSupport: ModeSupport;
    private lastFaultKey?: string;

    /** Set only when the unit reports energy monitoring and it isn't disabled in config. */
    private readonly energyStore?: EnergyLedgerStore;
    private energyLedger: EnergyLedger = emptyLedger();
    /** False until a ledger is restored or the first report arrives, so Home sees null, not a fake 0. */
    private energyKnown = false;
    private pollInFlight = false;
    /** True while polls are failing, so an outage is logged once rather than every poll. */
    private pollFailing = false;

    private static readonly DEFAULT_POLL_SECONDS = 10;
    private static readonly MIN_POLL_SECONDS = 5;
    private static readonly MAX_POLL_SECONDS = 120;
    /** MELView buckets usage hourly, so there's nothing to gain from polling energy often. */
    private static readonly ENERGY_POLL_MS = 15 * 60 * 1000;

    constructor(
        private readonly platform: MelviewMitsubishiHomebridgePlatform,
        private readonly device: Unit,
    ) {
        this.acUuid = this.matter.uuid.generate(device.unitid);
        this.modeSupport = modeSupportFor(device.capabilities, Boolean(platform.config.dry));
        if (this.exposesOutdoor()) {
            this.outdoorUuid = this.matter.uuid.generate(device.unitid + '-outdoor');
        }
        if (device.capabilities?.hasenergy === 1) {
            if (platform.config.energy === false) {
                this.platform.log.info('ENERGY Capability:', device.room, '[REPORTED BY UNIT - disabled in config]');
            } else {
                this.energyStore = new EnergyLedgerStore(
                    path.join(platform.api.user.storagePath(), 'mitsubishi-ac-au-nz'), device.unitid);
                const restored = this.energyStore.load();
                this.energyLedger = restored ?? emptyLedger();
                this.energyKnown = restored !== undefined;
                this.platform.log.info('ENERGY Capability:', device.room, '[REPORTING TO HOME]');
            }
        }
    }

    private get matter() {
        return this.platform.api.matter!;
    }

    private get state(): State {
        return this.device.state!;
    }

    /** All Matter accessories this unit publishes (AC, plus outdoor sensor if enabled). */
    public buildAccessories(): MatterAccessory[] {
        const accessories: MatterAccessory[] = [this.buildAcAccessory()];
        if (this.outdoorUuid) {
            accessories.push(this.buildOutdoorAccessory());
        }
        return accessories;
    }

    public uuids(): string[] {
        return this.outdoorUuid ? [this.acUuid, this.outdoorUuid] : [this.acUuid];
    }

    // ---- Descriptor builders -------------------------------------------------

    private buildAcAccessory(): MatterAccessory {
        return {
            UUID: this.acUuid,
            displayName: this.device.room,
            deviceType: this.matter.deviceTypes.RoomAirConditioner,
            serialNumber: this.device.unitid,
            manufacturer: 'Mitsubishi Electric',
            model: this.device.capabilities?.adaptortype ?? 'Mitsubishi AC',
            context: {unitid: this.device.unitid},
            clusters: {
                onOff: {onOff: this.state.power === 1},
                // Spread so the typed cluster states satisfy the descriptor's
                // index-signature fallback; the helpers themselves stay strict.
                thermostat: {...this.thermostatState(true)},
                fanControl: {...this.fanState()},
                // Declaring cumulativeEnergyImported is what makes Homebridge add the
                // ElectricalEnergyMeasurement cluster (Imported + Cumulative features).
                ...(this.energyStore ?
                    {electricalEnergyMeasurement: {cumulativeEnergyImported: this.energyMeasurement()}} : {}),
            },
            handlers: {
                onOff: {
                    on: () => this.command(new CommandPower(1, this.device, this.platform)),
                    off: () => this.command(new CommandPower(0, this.device, this.platform)),
                },
                thermostat: {
                    systemModeChange: (a: {systemMode: number}) => this.applySystemMode(a.systemMode),
                    occupiedCoolingSetpointChange: (a: {occupiedCoolingSetpoint: number}) =>
                        this.applySetpoint(a.occupiedCoolingSetpoint),
                    occupiedHeatingSetpointChange: (a: {occupiedHeatingSetpoint: number}) =>
                        this.applySetpoint(a.occupiedHeatingSetpoint),
                },
                fanControl: {
                    percentSettingChange: (a: {percentSetting: number | null}) =>
                        this.applyFanPercent(a.percentSetting),
                    fanModeChange: (a: {fanMode: number}) => this.applyFanMode(a.fanMode),
                },
            },
        };
    }

    private buildOutdoorAccessory(): MatterAccessory {
        return {
            UUID: this.outdoorUuid!,
            displayName: `${this.device.room} Outdoor`,
            deviceType: this.matter.deviceTypes.TemperatureSensor,
            serialNumber: `${this.device.unitid}-outdoor`,
            manufacturer: 'Mitsubishi Electric',
            model: 'Outdoor Temperature',
            context: {unitid: this.device.unitid},
            clusters: {
                temperatureMeasurement: {measuredValue: this.outdoorCentiDegrees()},
            },
        };
    }

    // ---- Home -> device handlers --------------------------------------------

    private async command(...commands: [Command, ...Command[]]): Promise<void> {
        const [first, ...rest] = commands;
        const response = await this.platform.melviewService?.command(first, ...rest);
        if (response && this.device.state) {
            applyCommandResponse(this.device.state, response);
        }
        await this.pushAcState();
    }

    private applySystemMode(systemMode: number): Promise<void> {
        const target = systemModeToCommand(systemMode, this.modeSupport);
        if (!target) {
            this.platform.log.warn('Ignoring mode', systemMode, 'for', this.device.room,
                '- the unit does not report support for it.');
            // Push the real state back so Home doesn't sit on the rejected mode.
            return this.pushAcState();
        }
        if (target.power === 0) {
            return this.command(new CommandPower(0, this.device, this.platform));
        }
        const onCmd = new CommandPower(1, this.device, this.platform);
        if (target.workMode !== undefined) {
            return this.command(onCmd, new CommandWorkMode(target.workMode, this.device, this.platform));
        }
        return this.command(onCmd);
    }

    private applySetpoint(centiDegrees: number): Promise<void> {
        const limits = this.setpointLimits();
        const range = this.state.setmode === WorkMode.HEAT ? limits.heat : limits.cool;
        const target = clampToRange(fromCentiDegrees(centiDegrees), range);
        return this.command(new CommandTemperature(target, this.device, this.platform));
    }

    private applyFanPercent(percent: number | null): Promise<void> {
        const code = percentToFanCode(percent, this.device.capabilities);
        return this.command(new CommandFanCode(code, this.device, this.platform));
    }

    /**
     * Fan mode only needs handling for the cases the percent slider can't express:
     * Off and Auto. Numeric speed modes are driven by percentSettingChange, so we
     * ignore them here to avoid sending a duplicate command.
     *
     * Both Off and Auto map to fan code 0 - MELView has no "fan stopped while
     * running" state, and reads code 0 as auto on units that support auto fan.
     */
    private applyFanMode(fanMode: number): Promise<void> | void {
        if (fanMode === FanMode.Off || fanMode === FanMode.Auto) {
            return this.command(new CommandFanCode(0, this.device, this.platform));
        }
    }

    // ---- device -> Home state push ------------------------------------------

    public async pushState(): Promise<void> {
        await this.pushAcState();
        await this.pushOutdoorState();
    }

    private async pushAcState(): Promise<void> {
        try {
            await this.matter.updateAccessoryState(this.acUuid, 'onOff', {onOff: this.state.power === 1});
            await this.matter.updateAccessoryState(this.acUuid, 'thermostat', this.thermostatState(false));
            await this.matter.updateAccessoryState(this.acUuid, 'fanControl', this.fanState());
        } catch (e) {
            this.platform.log.debug('Failed to push Matter state for', this.device.room, String(e));
        }
    }

    private async pushEnergyState(): Promise<void> {
        try {
            await this.matter.updateAccessoryState(this.acUuid, 'electricalEnergyMeasurement',
                {cumulativeEnergyImported: this.energyMeasurement()});
        } catch (e) {
            this.platform.log.debug('Failed to push energy for', this.device.room, String(e));
        }
    }

    private async pushOutdoorState(): Promise<void> {
        if (!this.outdoorUuid) {
            return;
        }
        try {
            await this.matter.updateAccessoryState(this.outdoorUuid, 'temperatureMeasurement',
                {measuredValue: this.outdoorCentiDegrees()});
        } catch (e) {
            this.platform.log.debug('Failed to push outdoor temperature for', this.device.room, String(e));
        }
    }

    // ---- State mapping helpers ----------------------------------------------

    private thermostatState(includeLimits: boolean): ThermostatState {
        const limits = this.setpointLimits();
        const base: ThermostatState = {
            localTemperature: toCentiDegrees(this.state.roomtemp) ?? null,
            systemMode: workModeToSystemMode(this.state),
            thermostatRunningMode: workModeToRunningMode(this.state),
            ...occupiedSetpoints(this.state.settemp, limits),
        };
        if (includeLimits) {
            base.controlSequenceOfOperation = controlSequenceFor(this.device.capabilities);
            base.minCoolSetpointLimit = limits.cool.min * 100;
            base.maxCoolSetpointLimit = limits.cool.max * 100;
            base.absMinCoolSetpointLimit = limits.cool.min * 100;
            base.absMaxCoolSetpointLimit = limits.cool.max * 100;
            base.minHeatSetpointLimit = limits.heat.min * 100;
            base.maxHeatSetpointLimit = limits.heat.max * 100;
            base.absMinHeatSetpointLimit = limits.heat.min * 100;
            base.absMaxHeatSetpointLimit = limits.heat.max * 100;
            base.minSetpointDeadBand = 0;
        }
        return base;
    }

    /** Cumulative energy in Matter mWh, or null before any reading is known. */
    private energyMeasurement(): {energy: number} | null {
        return this.energyKnown ? {energy: Math.round(cumulativeWh(this.energyLedger) * 1000)} : null;
    }

    private fanState(): FanControlState {
        const percent = fanCodeToPercent(this.state.setfan, this.device.capabilities);
        return {
            fanMode: fanCodeToFanMode(this.state.setfan, this.device.capabilities),
            fanModeSequence: fanModeSequenceFor(this.device.capabilities),
            percentSetting: percent,
            percentCurrent: percent,
        };
    }

    private setpointLimits(): SetpointLimits {
        return {
            cool: this.range(WorkMode.COOL, DEFAULT_COOL_RANGE),
            heat: this.range(WorkMode.HEAT, DEFAULT_HEAT_RANGE),
        };
    }

    private range(mode: WorkMode, fallback: Range): Range {
        return this.state.max?.[mode + ''] ?? fallback;
    }

    private exposesOutdoor(): boolean {
        return Boolean(this.platform.config.outdoorTemperature) &&
            Number.isFinite(Number.parseFloat(this.device.state?.outdoortemp ?? ''));
    }

    /** Outdoor reading in Matter centi-°C, or null when missing/implausible (placeholder guard). */
    private outdoorCentiDegrees(): number | null {
        const value = Number.parseFloat(this.state.outdoortemp ?? '');
        if (!Number.isFinite(value) || value < OUTDOOR_PLAUSIBLE_MIN || value > OUTDOOR_PLAUSIBLE_MAX) {
            return null;
        }
        return Math.round(value * 100);
    }

    // ---- Polling -------------------------------------------------------------

    public startPolling(): void {
        const intervalMs = this.resolvePollIntervalMs();
        // Stagger units so they don't all hit MELView on the same tick.
        const jitterMs = Math.floor(Math.random() * intervalMs);
        const startTimeout = setTimeout(() => {
            this.pollOnce();
            const pollingInterval = setInterval(() => this.pollOnce(), intervalMs);
            this.platform.registerPollingInterval(pollingInterval);
        }, jitterMs);
        this.platform.registerPollingInterval(startTimeout);

        if (this.energyStore) {
            const energyStart = setTimeout(() => {
                this.pollEnergy();
                const energyInterval = setInterval(() => this.pollEnergy(), MelviewMatterAccessory.ENERGY_POLL_MS);
                this.platform.registerPollingInterval(energyInterval);
            }, jitterMs);
            this.platform.registerPollingInterval(energyStart);
        }
    }

    /**
     * Fold MELView's hourly usage into the persisted ledger and publish the new
     * cumulative total. Energy events aren't throttled by Matter, so only push
     * when the total actually moved.
     */
    private pollEnergy(): void {
        const store = this.energyStore;
        if (!store) {
            return;
        }
        const now = new Date();
        this.platform.melviewService?.energyReport(this.device.unitid, energyPollStartDate(now))
            .then(async report => {
                const usage = parseHourlyUsage(report);
                const wasKnown = this.energyKnown;
                const before = cumulativeWh(this.energyLedger);
                this.energyLedger = applyHourlyUsage(this.energyLedger, usage, now);
                this.energyKnown = true;
                const total = cumulativeWh(this.energyLedger);
                if (!wasKnown) {
                    this.platform.log.info('Energy for', this.device.room + ':', usage.length, 'hourly readings,',
                        (total / 1000).toFixed(1), 'kWh total', report?.indicative === 1 ? '(estimated by MELView)' : '');
                }
                store.save(this.energyLedger);
                if (!wasKnown || total !== before) {
                    await this.pushEnergyState();
                }
            })
            .catch(e => {
                this.platform.log.debug('Unable to refresh energy for', this.device.room, 'from MELView:',
                    e instanceof Error ? e.message : String(e));
            });
    }

    private pollOnce(): void {
        const service = this.platform.melviewService;
        // A slow MELView reply (up to the request timeout) must not stack polls.
        if (!service || this.pollInFlight) {
            return;
        }
        this.pollInFlight = true;
        service.getStatus(this.device.unitid)
            .then(s => {
                if (this.pollFailing) {
                    this.pollFailing = false;
                    this.platform.log.info('MELView is reachable again for', this.device.room);
                }
                this.device.state = s;
                this.reportFault(s);
                this.pushState().finally();
            })
            .catch(e => {
                const message = e instanceof Error ? e.message : String(e);
                if (!this.pollFailing) {
                    this.pollFailing = true;
                    this.platform.log.error('Unable to refresh', this.device.room, 'from MELView:', message,
                        '- retrying every poll; further failures are logged at debug level.');
                } else {
                    this.platform.log.debug('Still unable to refresh', this.device.room, 'from MELView:', message);
                }
            })
            .finally(() => {
                this.pollInFlight = false;
            });
    }

    private resolvePollIntervalMs(): number {
        const configured = Number(this.platform.config.pollInterval);
        const seconds = Number.isFinite(configured) && configured > 0 ?
            configured : MelviewMatterAccessory.DEFAULT_POLL_SECONDS;
        const clamped = Math.min(
            Math.max(seconds, MelviewMatterAccessory.MIN_POLL_SECONDS),
            MelviewMatterAccessory.MAX_POLL_SECONDS,
        );
        return clamped * 1000;
    }

    /** Log MELView fault/error changes only (no per-poll spam). */
    private reportFault(state: State): void {
        const fault = (state.fault ?? '').trim();
        const error = (state.error ?? '').trim();
        const hasFault = fault !== '' && fault.toUpperCase() !== 'NONE';
        const hasError = error !== '' && error.toLowerCase() !== 'ok';

        const key = hasFault || hasError ? `${fault}|${error}` : '';
        if (key === (this.lastFaultKey ?? '')) {
            return;
        }
        this.lastFaultKey = key;

        if (key === '') {
            this.platform.log.info('Fault cleared:', this.device.room);
            return;
        }
        this.platform.log.warn(
            `MELView reported a fault for ${this.device.room} -`,
            hasFault ? `fault: ${fault}` : '',
            hasError ? `error: ${error}` : '',
        );
    }
}
