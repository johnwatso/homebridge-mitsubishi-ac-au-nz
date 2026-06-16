export interface Unit {
    room: string;
    name?: string;
    unitid: string;
    power: string;
    wifi: string;
    mode: string;
    temp: string;
    settemp: string;
    status: string;
    schedule1: number;
    capabilities?: Capabilities;
    state?: State;
}

export interface Building {
    buildingid: string;
    building: string;
    bschedule: string;
    units: Unit[];
}

export interface CountryInfo {
    country: string;
    companyname: string;
    supportphone: string;
    supporturl: string;
    addunitnote: string;
}

export interface Features {
    groupcontrol: number;
    zonerules: number;
    halfdegcontrol: number;
}

export interface Account {
    id: number;
    country: string;
    fullname: string;
    confirmcode: number;
    userunits: number;
    addbuilding: number;
    addunit: number;
    countryinfo: CountryInfo[];
    features: Features;
}

export interface Capabilities {
    id: string;
    unitname: string;
    unittype: string;
    fault: string;
    userunits: number;
    modeltype: number;
    multi: number;
    halfdeg: number;
    adaptortype: string;
    addons: string;
    localip: string;
    fanstage: number;
    hasairdir: number;
    hasswing: number;
    hasautomode: number;
    hascoolonly: number;
    hasautofan: number;
    hasdrymode: number;
    hasenergy: number;
    hasairauto: number;
    hasairdirh: number;
    max?: Record<string, Range>;
    time: string;
    error: string;
}

export interface State {
    id: string;
    unitname: string;
    userunits: number;
    modeltype: number;
    fanstage: number;
    hasairdir: number;
    hasswing: number;
    hasauto: number;
    max?: Record<string, Range>;
    power: number;
    standby: number;
    setmode: number;
    automode: number;
    setfan: number;
    settemp: string;
    roomtemp: string;
    outdoortemp: string;
    airdir: number;
    airdirh: number;
    sendcount: number;
    fault: string;
    error: string;
}

export enum WorkMode {
    HEAT = 1,
    DRY = 2,
    COOL = 3,
    FAN = 7,
    AUTO = 8
}

export interface Range {
    min: number;
    max: number;
}

export interface CommandResponse {
    id: string;
    lc: string;
    power: number;
    standby: number;
    setmode: number;
    automode: number;
    setfan: number;
    settemp: string;
    roomtemp: string;
    outdoortemp: string;
    airdir: number;
    airdirh: number;
    sendcount: number;
    fault: string;
    error: string;
}

/**
 * Merge the authoritative state returned by a MELView command into the locally
 * cached state so HomeKit can refresh immediately, without waiting for the next
 * poll. Only fields actually present in the response are applied.
 */
export function applyCommandResponse(state: State, response: CommandResponse): void {
    if (typeof response.power === 'number') {
        state.power = response.power;
    }
    if (typeof response.standby === 'number') {
        state.standby = response.standby;
    }
    if (typeof response.setmode === 'number') {
        state.setmode = response.setmode;
    }
    if (typeof response.automode === 'number') {
        state.automode = response.automode;
    }
    if (typeof response.setfan === 'number') {
        state.setfan = response.setfan;
    }
    if (typeof response.airdir === 'number') {
        state.airdir = response.airdir;
    }
    if (typeof response.airdirh === 'number') {
        state.airdirh = response.airdirh;
    }
    if (response.settemp) {
        state.settemp = response.settemp;
    }
    if (response.roomtemp) {
        state.roomtemp = response.roomtemp;
    }
    if (response.outdoortemp) {
        state.outdoortemp = response.outdoortemp;
    }
    if (response.fault !== undefined) {
        state.fault = response.fault;
    }
    if (response.error !== undefined) {
        state.error = response.error;
    }
}
