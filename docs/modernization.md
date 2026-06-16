# What changed vs the original

This plugin is a modernized fork of [`aurc/melview-mitsubishi-au-nz`](https://github.com/aurc/melview-mitsubishi-au-nz). It keeps the original's MELView-assisted control approach but rebuilds the HomeKit layer, adds the controls that were missing, and hardens the runtime. This page summarizes the differences.

## At a glance

| Area | Original (`aurc/melview-mitsubishi-au-nz`) | This fork |
| :--- | :--- | :--- |
| Homebridge / Node | Unspecified | Homebridge `2.0+`, Node `22`/`24` |
| Modes | Auto / heat / cool / experimental dry | Same, matched to each unit's reported capabilities |
| Fan speed | Not controllable | Native fan slider, steps matched to the unit's real fan stages, auto fan where supported |
| Swing | "Coming soon" | On/off for units that report swing |
| Dry mode | Experimental, no fan control | Optional dry/dehumidifier service, gated on unit support |
| Outdoor temperature | — | Optional separate temperature-sensor tile, with placeholder readings hidden |
| Command feedback | Wait for next poll | State applied immediately from the command response |
| Polling | Fixed | Configurable interval, staggered across units |
| Resilience | — | Per-unit isolation, de-duped re-auth, empty-listing guard |
| Tests | — | Unit tests for the pure mapping logic |

## Platform & tooling
- Targets **Homebridge 2.0+** and **Node 22/24**, building against the current Homebridge 2 API and Matter-era type definitions.
- Uses Homebridge's dynamic-platform model so units are registered once and restored from cache cleanly.
- Stricter TypeScript, refreshed dependencies and lockfile, and a small unit-test suite (`npm test`).

## HomeKit model
- **Native heater-cooler only.** Fan speed and swing live on the AC tile itself — there's no separate "pretend" fan accessory, and no custom characteristics that only render in third-party apps.
- **Capability-aware.** Modes, fan stages, swing, and dry are read per-unit from MELView, so the exposed controls match what each unit actually supports (e.g. cool-only and auto-capable units are detected; the fan slider's detents match the unit's real fan stages).
- **Outdoor temperature** is exposed as its own temperature-sensor tile when enabled and available.
- Removed an unsupported HomeKit fault characteristic and the legacy fan service from cached accessories.

## Responsiveness & reliability
These are the runtime behaviours this fork adds on top of the original:

- **Instant command feedback** — after every command the plugin applies the unit's authoritative returned state and refreshes the tile immediately, instead of waiting for the next poll.
- **Relaxed, staggered polling** — units poll on a configurable interval (`pollInterval`, default 10s) with a random offset so they don't all hit MELView on the same tick, avoiding self-inflicted rate-limiting.
- **Resilient discovery** — each unit is set up independently, so one flaky unit can't abort discovery for the rest; a transient empty MELView listing will **not** wipe your existing accessories.
- **Smart re-authentication** — token refreshes are awaited and de-duplicated, so many polling units near token expiry don't trigger a login stampede.
- **Clear fault logging** — MELView fault/error states are logged when they change (not spammed every poll), and obviously-bad outdoor readings are treated as a fault rather than shown.
- **Clean shutdown** — polling timers are cleared on Homebridge shutdown.

## Still shared with the original
- MELView-assisted control with a direct-to-unit LAN fast path (see [Setup → How it works](setup.md#how-it-works)).
- An internet connection is still required for MELView authentication — this is not offline-only control.

## Not changed yet
- **Energy reporting** — not exposed; see [energy-reporting.md](energy-reporting.md).
- **Vane positions / multi-axis swing** — Apple Home's native AC UI only supports a single swing on/off toggle, so precise vane positioning isn't exposed.
