# What changed vs the original

This plugin is a modernized fork of [`aurc/melview-mitsubishi-au-nz`](https://github.com/aurc/melview-mitsubishi-au-nz). It keeps the original's MELView-assisted control approach but replaces the output layer with **native Matter**, adds the controls that were missing, and hardens the runtime. This page summarizes the differences.

## At a glance

| Area | Original (`aurc/melview-mitsubishi-au-nz`) | This fork |
| :--- | :--- | :--- |
| Protocol | HAP (Apple Home only) | **Native Matter** (Apple Home, Google, Alexa, SmartThings) |
| Accessory | Single thermostat-style HAP accessory | Matter `RoomAirConditioner` (+ optional outdoor sensor) |
| Homebridge / Node | Unspecified | Homebridge `2.0+`, Node `22`/`24` |
| Modes | Auto / heat / cool / experimental dry | Same, matched to each unit's reported capabilities |
| Fan speed | Controllable | Matter FanControl, with steps matched to the unit's real fan stages and auto fan where supported |
| Swing | "Coming soon" | Not exposed (Homebridge's Matter wrapper has no swing handler) |
| Dry mode | Experimental, no fan control | Optional, mapped to Matter `SystemMode.Dry` (best-effort) |
| Outdoor temperature | — | Optional separate Matter temperature-sensor tile, placeholder readings hidden |
| Command feedback | Wait for next poll | State applied immediately from the command response |
| Polling | Fixed | Configurable interval, staggered across units |
| Resilience | — | Per-unit isolation, de-duped re-auth, empty-listing guard |
| Tests | — | Unit tests for the pure mapping logic |

## Platform & tooling
- Targets **Homebridge 2.0+** and **Node 22/24**, building against the current Homebridge 2 Matter API (`api.matter`).
- Registers Matter accessories once and restores them from cache cleanly (`configureMatterAccessory`); removes the old HAP accessories from previous versions automatically on first launch.
- Stricter TypeScript, refreshed dependencies and lockfile, and a small unit-test suite (`npm test`).

## Matter model
- **Native Matter device types only** — each unit is a `RoomAirConditioner` (OnOff + Thermostat + FanControl). No "pretend" fan accessory, no custom characteristics that only render in third-party apps.
- **Capability-aware** — modes, fan stages, and dry are read per-unit from MELView, so the exposed controls match what each unit actually supports (cool-only and auto-capable units are detected; the fan steps match the unit's real fan stages).
- **Outdoor temperature** is a separate Matter `TemperatureSensor` when enabled and available, with implausible/placeholder readings hidden.
- **Multi-ecosystem** — because it's Matter, the same accessory works in Apple Home, Google Home, Alexa, and SmartThings.

## Responsiveness & reliability
Runtime behaviours this fork adds on top of the original:

- **Instant command feedback** — after every command the plugin applies the unit's authoritative returned state and refreshes immediately, instead of waiting for the next poll.
- **Relaxed, staggered polling** — units poll on a configurable interval (`pollInterval`, default 10s) with a random offset so they don't all hit MELView on the same tick, avoiding self-inflicted rate-limiting.
- **Resilient discovery** — each unit is set up independently, so one flaky unit can't abort discovery for the rest; a transient empty MELView listing will **not** wipe your existing accessories.
- **Smart re-authentication** — token refreshes are awaited and de-duplicated, so many polling units near token expiry don't trigger a login stampede.
- **Clear fault logging** — MELView fault/error states are logged when they change (not spammed every poll), and obviously-bad outdoor readings are treated as a fault rather than shown.
- **Clean shutdown** — polling timers are cleared on Homebridge shutdown.

## Still shared with the original
- MELView-assisted control with a direct-to-unit LAN fast path (see [Setup → How it works](setup.md#how-it-works)).
- An internet connection is still required for MELView authentication — this is not offline-only control.

## Trade-offs of the Matter move
- **Swing dropped** — Homebridge's Matter FanControl wrapper exposes no swing (`rockSetting`) handler, so swing isn't controllable until Homebridge adds it. The HAP version had a swing on/off toggle.
- **Dry mode** is best-effort (`SystemMode.Dry`); Apple Home's rendering isn't guaranteed across iOS versions.
- **Re-pair required** — Matter is a separate pairing, so upgrading from the HAP version means re-adding the units. See [Setup → Migrating from the HAP version](setup.md#migrating-from-the-hap-version).
- **Experimental** — Homebridge 2.0's Matter support is still stabilising.

## Not changed yet
- **Energy reporting** — not exposed; blocked on Homebridge surfacing the Matter energy clusters and on confirming MELView's energy data source. See [energy-reporting.md](energy-reporting.md).
