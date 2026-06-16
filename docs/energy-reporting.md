# Energy reporting — research & design notes

Status: **groundwork only. Not implemented.** Last reviewed: 2026-06-16.

> Update: the plugin has since migrated from HAP to **Homebridge 2.0 native Matter**.
> That removes the "HAP has no energy characteristic" blocker in principle, but
> introduces a concrete one: **Homebridge 2.1.0's Matter API does not expose the
> Electrical Power/Energy Measurement clusters to plugins** (verified — no
> electrical/energy references in `node_modules/homebridge/dist/matter`; the
> wrapped clusters are OnOff, Thermostat, FanControl, TemperatureMeasurement,
> etc.). Energy stays blocked on Homebridge surfacing those clusters **and** the
> unknown MELView energy endpoint below.

## Goal

Surface the AC's energy usage in a way that stays "fully Apple-native" — i.e. only
if/when Apple Home itself can render it, not via custom characteristics that only
appear in third-party apps (Eve/Controller). See the project's
"Apple-native north star".

## The native surface is Matter, not HAP

Two related-but-separate Apple pieces:

- **EnergyKit (iOS 26, WWDC 2025)** — an **app-layer** framework: Grid Forecast
  (cleaner/cheaper windows) and "load events" for *insight* and *load shifting*,
  focused on HVAC + EV. Not an accessory-published characteristic.
- **iOS 27 Apple Home "Energy" tab** — the **device-data** side. It reads energy
  from **Matter 1.3** clusters:
  - **Electrical Power Measurement cluster (2.13)** — instantaneous power (W).
  - **Electrical Energy Measurement cluster (2.12)** — cumulative energy (kWh).
  - As of the iOS 27 beta the tab is **view-only**: energy is not yet an
    automation trigger/condition (Apple says this will expand before release).

**Critical implication for this plugin:** classic **HAP has no native
energy-consumption characteristic** (Apple's HomeKit characteristic list has no
AC watts/kWh), and the iOS 27 Energy tab consumes **Matter**, not HAP. This
plugin is a Homebridge **HAP** bridge, so it **cannot feed the iOS 27 Energy tab
as-is**. Exposing energy natively would require presenting the unit as a **Matter**
device with the Electrical Power/Energy Measurement clusters — e.g. via
**Matterbridge** (an electrical-sensor device type) rather than classic
homebridge-HAP. "Waiting for a HAP characteristic" is the wrong mental model;
the path is Matter bridging.

## Open questions to resolve before implementing

1. **MELView data source.** MELView capabilities include `hasenergy`, but the
   current `State` / `CommandResponse` payloads carry no energy figures, and we
   have no known MELView energy endpoint. Confirm by capturing the Mitsubishi
   Wi-Fi Control app traffic: is there an energy/history endpoint, what does it
   return (instantaneous W? kWh totals? runtime minutes?), and at what cadence.
2. **Delivery mechanism.** The plugin is already a Matter accessory, so the
   natural path is to add the Electrical Power/Energy Measurement clusters to the
   existing `RoomAirConditioner` — **once Homebridge exposes them** via `api.matter`
   (it does not today). Until then there is no native delivery path. Non-native
   Eve custom characteristics remain out of scope (violates the Apple-native north
   star).
3. **Units & semantics.** Map MELView's granularity to the Matter clusters:
   instantaneous W → Power Measurement; cumulative kWh → Energy Measurement.

## Current code touchpoints

- `Capabilities.hasenergy` (src/data.ts) — already present.
- `matterAccessory.ts` logs `ENERGY Capability` when a unit advertises
  `hasenergy === 1`, so users can see which units report support. No energy
  cluster is registered.

## Decision

Hold implementation until (1) Homebridge's `api.matter` exposes the Electrical
Power/Energy Measurement clusters and (2) the MELView energy endpoint is
confirmed. At that point the clusters can be added to the existing
`RoomAirConditioner` accessory in `matterAccessory.ts`.

## Sources

- Apple EnergyKit — <https://developer.apple.com/energykit/>
- iOS 27 native energy management (Matter) —
  <https://www.matteralpha.com/industry-news/ios-27-apple-home-thread-1-4-4k-energy>
- Matter energy clusters overview —
  <https://matter-smarthome.de/en/development/energy-management-in-the-matter-standard/>
