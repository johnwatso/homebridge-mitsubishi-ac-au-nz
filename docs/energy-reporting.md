# Energy reporting

Status: **implemented, unreleased.** Last reviewed: 2026-09-14.

Units that report MELView Energy Monitoring (`hasenergy === 1`) publish their
cumulative energy use to Apple Home over Matter. The iOS 27+ Home app reads it
from the **Electrical Energy Measurement** cluster. Set `"energy": false` in the
plugin config to turn it off.

## Data source: `energyreport.aspx`

MELView's energy data isn't in the `unitcommand.aspx` state the plugin polls. It
comes from a separate endpoint used by the Wi-Fi Control app's Energy page. We
found it in the app's web build at `https://app.melview.net/js/ex.js`, which is
the same Cordova bundle the phone app ships.

Request (authenticated with the usual `auth` cookie):

```json
POST https://api.melview.net/api/energyreport.aspx
{"unitid": "…", "period": "D", "startdate": "2026-09-14", "rows": 48, "v": 5}
```

- `period`: `D` returns hourly buckets, `M` daily, `Y` monthly.
- `startdate`: formatted `yyyy-MM-d`.
- `rows`: how many buckets to return, counting **forward** from `startdate`'s
  midnight. Future hours come back as `used: 0`. Confirmed live: `startdate`
  set to today with 48 rows returned today plus tomorrow.

Response (fields the app reads):

- `energy[]`: one bucket per period, `{date: "yyyy-MM-dd HH:mm:ss", used, power, heating, cooling, auto, other, settemp}`.
  - `used` is in **Wh**; the app divides it by 1000 to show kWh.
- `sdate` / `cdate`: the earliest date with data / the first date returned.
- `timezone` / `offset`: the unit's timezone (e.g. `New Zealand Standard Time`,
  `720`); bucket `date`s are in that local time.
- `indicative`: `1` means usage is *estimated* by algorithm, not metered by
  updated outdoor-unit firmware ("Enhanced Energy View").
- `note`, `titleenergy`, `costaverage`: display text for the app.

Resolution is about 100 Wh, and Mitsubishi labels the figures as estimates.

## How the plugin maps it

- **Polling.** Every 15 minutes (MELView only buckets hourly), fetch hourly
  buckets starting **yesterday** (`period: D`, `rows: 48`). Late readings for
  the previous day's last hours still land after midnight.
- **Ledger** (`src/energy.ts`). Matter's `cumulativeEnergyImported` must never
  go down, but MELView only gives per-hour usage.
  - Hours from the last 72 are kept in a map and stay revisable; a bucket only
    ever grows.
  - Older hours are folded into a settled total.
  - The ledger is saved to
    `<homebridge storage>/mitsubishi-ac-au-nz/energy-<unitid>.json`, so the
    total survives restarts. Deleting that file restarts the total, back-filled
    with only the last ~48 hours.
- **Matter.** The `RoomAirConditioner` declares
  `electricalEnergyMeasurement: {cumulativeEnergyImported: {energy: mWh}}`.
  - Homebridge ≥ 2.2 detects that and adds PowerTopology plus
    ElectricalEnergyMeasurement (Imported + Cumulative). 2.3.0 is required for
    the Matter fixes.
  - The value is `null` until the first report arrives, and is only pushed when
    it changes (energy events aren't throttled).
- **No Electrical Power Measurement.** MELView has no instantaneous power
  reading. Deriving "live" watts from hourly totals would publish a fabricated
  value, which goes against the Apple-native goal.

## What Apple Home shows (caveats)

- **Per-device listing.** Bridged Matter accessories count toward the
  whole-home total in the iOS 27 Energy view but aren't listed per device.
  Live tile wattage is only shown for outlets. (Both observed by
  homebridge-shelly-matter; not yet confirmed for an air conditioner.)
- **Lag.** Usage lands up to an hour or more late, in ~100 Wh steps.
- **Supported units.** Energy Monitoring is only available on some models; see
  Mitsubishi's list.

## Verification

The request and response shape was confirmed against a live NZ unit on
2026-09-15 (`energy[]` buckets with `date`, `used`, mode flags, `settemp`,
`power`). `used` is Wh: readings on a heating day were 100–1000 per hour, in
100 Wh steps, adding up to 6200 for the day (6.2 kWh). As 0.1 kWh units that
would be 80–100 kWh per hour, which is physically impossible for a
residential heat pump. Readings for the current hour showed up within the
same morning, so the lag is small. The parser skips anything malformed, and the first report
per unit is logged (`Energy for <room>: N hourly readings, X kWh total`), so a
mismatch shows up in the logs rather than as bad data in Home.

## Sources

- Wi-Fi Control web app bundle — <https://app.melview.net/js/ex.js>
- Mitsubishi Wi-Fi Control Energy Monitoring — <https://www.mitsubishi-electric.co.nz/wifi/energy-monitoring.aspx>
- Homebridge releases (Matter electrical clusters, 2.2.0) — <https://github.com/homebridge/homebridge/releases>
- homebridge-shelly-matter (reference implementation, iOS 27 display notes) — <https://github.com/keremerkan/homebridge-shelly-matter>
- iOS 27 Apple Home energy — <https://www.matteralpha.com/industry-news/ios-27-apple-home-thread-1-4-4k-energy>
