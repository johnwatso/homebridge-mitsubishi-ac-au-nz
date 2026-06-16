<h1 align="center">Homebridge Mitsubishi AC AU/NZ</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-mitsubishi-ac-au-nz"><img src="https://img.shields.io/npm/v/homebridge-mitsubishi-ac-au-nz.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-22%20%7C%2024-339933.svg" alt="Node.js"></a>
  <a href="https://homebridge.io/"><img src="https://img.shields.io/badge/homebridge-%3E%3D2.0-purple.svg" alt="Homebridge"></a>
  <a href="#features"><img src="https://img.shields.io/badge/HomeKit-AC-0f7fff.svg" alt="HomeKit AC"></a>
  <a href="#how-it-works"><img src="https://img.shields.io/badge/control-MELView%20%2B%20LAN-success.svg" alt="MELView assisted LAN"></a>
</p>

<p align="center">
  <img src="assets/homebridge-mitsubishi-ac-au-nz.png" alt="Homebridge Mitsubishi AC AU/NZ" width="320">
</p>

Bring your Mitsubishi Electric **Wi-Fi Control** air conditioners and heat pumps into Apple Home. Each unit appears as a native HomeKit heater-cooler with heat, cool, auto, fan speed, swing, and optional dry mode — and commands snap to their new state instantly rather than waiting on a poll.

This is a modernized fork of [`aurc/melview-mitsubishi-au-nz`](https://github.com/aurc/melview-mitsubishi-au-nz), updated for current Node and Homebridge 2.0, with expanded HomeKit support and a focus on responsiveness and reliability. Published on npm as [`homebridge-mitsubishi-ac-au-nz`](https://www.npmjs.com/package/homebridge-mitsubishi-ac-au-nz).

> [!NOTE]
> **Region:** Built for Mitsubishi Electric units in Australia and New Zealand that pair with the **Mitsubishi Wi-Fi Control** app (MELView). If your unit shows up in that app, it's a good candidate.

## Contents
- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Supported hardware](#supported-hardware)
- [Installation](#installation)
- [Configuration](#configuration)
- [Responsiveness & reliability](#responsiveness--reliability)
- [Network notes](#network-notes)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Credits & license](#credits--license)

## Features
Each unit is exposed as a single, native Apple Home **heater-cooler** tile:

- **Power** — turn the unit on and off.
- **Mode** — heat, cool, and auto, matched to what the unit actually supports (cool-only and auto-capable units are detected).
- **Fan speed** — driven from the AC tile's fan slider, with the number of steps matched to the unit's real fan stages, including auto fan where supported.
- **Swing** — on/off for units that report swing support.
- **Target temperature** — within each unit's supported heating/cooling range; always Celsius (HomeKit's native unit for MELView).
- **Room temperature** — live indoor reading.
- **Outdoor temperature** *(optional)* — exposed as a separate temperature-sensor tile when available, with implausible/placeholder readings hidden.
- **Dry / dehumidifier mode** *(optional)* — exposed for units that support it when enabled in config.
- **Siri, scenes & automations** — works with everything Apple Home offers through Homebridge.

The plugin deliberately sticks to HomeKit-native AC features — no "pretend" fan accessory, no custom characteristics that only show up in third-party apps.

## How it works
Control is **MELView-assisted with a local fast path**. For each command the plugin:

1. Authenticates with your MELView account and sends the command through MELView.
2. Receives a local command token in the response.
3. Fires a direct LAN request to the unit's Wi-Fi module using that token:

   ```text
   http://<unit-local-ip>/smart
   ```

This isn't fully offline local control — MELView is still used for login, discovery, and authorization — but the LAN hop makes commands feel far snappier than cloud-only integrations. The plugin also applies the unit's returned state immediately, so the tile reflects reality without waiting for the next poll.

## Requirements
- **Homebridge** `>= 2.0.0`
- **Node.js** `22` or `24`
- A **Mitsubishi Wi-Fi Control / MELView** account with your units already added in the app
- Network reachability from the Homebridge host to each unit's LAN IP (see [Network notes](#network-notes))

## Supported hardware
Intended for Mitsubishi Electric air conditioners and heat pumps in AU/NZ that work with the **Wi-Fi Control** app. Known-working combinations from the original project:

| Indoor Unit | Wi-Fi Module |
| :--- | :--- |
| MSZ-GL71VGD | MAC-568IF-E |
| MSZ-GL35VGD | MAC-568IF-E |
| MSZ-AP25VGD | MAC-568IF-E |

Other models that appear in the Wi-Fi Control app are likely to work; capabilities (modes, fan stages, swing, dry) are read per-unit from MELView.

## Installation
1. Install [Homebridge](https://homebridge.io/).
2. In the Homebridge Config UI, search for **`homebridge-mitsubishi-ac-au-nz`** and install it.
3. Enter your Mitsubishi Wi-Fi Control account credentials.
4. Restart Homebridge.

Or install from the command line:

```bash
npm install -g homebridge-mitsubishi-ac-au-nz
```

## Configuration
Add the platform to your Homebridge `config.json`:

```json
{
  "platform": "MitsubishiAUNZ",
  "user": "user@example.com",
  "password": "your-password",
  "dry": false,
  "outdoorTemperature": false,
  "pollInterval": 10
}
```

| Setting | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `platform` | Yes | — | Must be `MitsubishiAUNZ`. |
| `user` | Yes | — | Mitsubishi Wi-Fi Control / MELView account email. |
| `password` | Yes | — | Mitsubishi Wi-Fi Control / MELView account password. |
| `dry` | No | `false` | Expose supported units' dry mode as a HomeKit dehumidifier service. |
| `outdoorTemperature` | No | `false` | Expose MELView outdoor temperature as a separate HomeKit temperature sensor when available. |
| `pollInterval` | No | `10` | Seconds between MELView state refreshes (range `5`–`120`). Commands update instantly, so this only catches changes made outside HomeKit (e.g. the wall remote). Higher is gentler on the MELView API. |

Keep the platform on the main bridge unless you specifically want it isolated — no child bridge is required.

### A note on the outdoor temperature tile
Apple Home pools every temperature sensor in a room into that room's climate summary. If you enable `outdoorTemperature` and the sensor sits in the same room as the indoor unit, it will pull that room's average toward the outdoor reading. Assign the outdoor tile to a different room if that bothers you — the AC's own current-temperature reading is unaffected either way.

## Responsiveness & reliability
This fork puts real effort into making the accessory feel native and behave well on flaky networks and multi-unit accounts:

- **Instant command feedback** — after every command the plugin applies the unit's authoritative returned state and refreshes the tile immediately, instead of waiting for the next poll.
- **Capability-aware fan slider** — the slider's steps are derived from each unit's reported fan stages, so a 3-speed unit shows three detents and a 5-speed unit shows five, with auto fan handled where supported.
- **Relaxed, staggered polling** — units poll on a configurable interval with a random offset so they don't all hit MELView on the same tick (avoids self-inflicted rate-limiting).
- **Resilient discovery** — each unit is set up independently, so one flaky unit can't abort discovery for the rest; a transient empty MELView listing will **not** wipe your existing accessories.
- **Smart re-authentication** — token refreshes are awaited and de-duplicated, so many polling units near token expiry don't trigger a login stampede.
- **Clear fault logging** — MELView fault/error states are logged when they change (not spammed every poll), and obviously-bad outdoor readings are treated as a fault rather than shown.

## Network notes
This plugin is **not fully local-only.** It uses MELView for login, discovery, status polling, and command authorization, and only the per-command follow-up goes directly to the unit over your LAN.

For best results, the Homebridge host should be able to reach each Wi-Fi module's local IP. If Homebridge and your heat pumps are on different VLANs, allow traffic from Homebridge to the modules.

## Known limitations
- **Internet required** — MELView authentication is needed for normal operation; it is not offline-only control.
- **Dry mode** — optional and less thoroughly tested than heat/cool.
- **Swing** — exposed only for units that report swing support through MELView.
- **Vane direction** — exposed as swing on/off, not precise vertical/horizontal vane positions (HomeKit has no native vane control).
- **Outdoor temperature** — off by default; MELView data varies between units, so implausible/placeholder readings are hidden rather than shown.
- **Energy reporting** — not exposed yet (see [Roadmap](#roadmap)).

## Roadmap
- **Energy reporting** — many units advertise energy support via MELView, but there's no clean native path to surface it in Apple Home today. Classic HomeKit (HAP) has no energy-consumption characteristic, and iOS 27's native Apple Home **Energy** tab is fed by **Matter** (Electrical Power/Energy Measurement clusters) rather than HAP. A native Matter version of this plugin has been prototyped (kept on a separate branch) and will be revisited once Homebridge's Matter API exposes those energy clusters and the MELView energy data source is confirmed. Units advertising energy support are logged in the meantime.

## Troubleshooting
- **"Plugin has not been configured"** — add your MELView `user` and `password` in the plugin config.
- **"Unable to find accessory status / Unable to access unit via direct LAN interface"** — usually a network reachability issue: confirm the Homebridge host can reach the unit's LAN IP, and check VLAN/firewall rules. Cloud-only operation still works without the LAN path, just less snappily.
- **Login fails / auth token errors** — verify the credentials work in the Mitsubishi Wi-Fi Control app; you may need to reset your password with Mitsubishi.
- **A unit disappeared from Home** — the plugin only removes accessories MELView genuinely stops reporting; a one-off empty/erroring response is ignored. If a unit was removed in MELView, it will be removed here too.
- **More detail** — enable Homebridge debug logging (`-D`) to see per-command and per-poll diagnostics.

## Development
```bash
npm install      # install dependencies
npm run build    # compile TypeScript
npm run lint     # eslint (zero warnings)
npm test         # unit tests (node:test)
npm audit        # dependency audit
npm link         # symlink for local Homebridge testing
```

Tests cover the pure mapping logic (fan-stage mapping, command-response merging). Please keep `build`, `lint`, and `test` green.

## Credits & license
Builds on the original [`aurc/melview-mitsubishi-au-nz`](https://github.com/aurc/melview-mitsubishi-au-nz) project and the MELView reverse-engineering notes from [`NovaGL/diy-melview`](https://github.com/NovaGL/diy-melview).

Licensed under [Apache-2.0](LICENSE).
