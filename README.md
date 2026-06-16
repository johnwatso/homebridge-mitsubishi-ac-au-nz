<h1 align="center">Homebridge Mitsubishi AC AU/NZ</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-mitsubishi-ac-au-nz"><img src="https://img.shields.io/npm/v/homebridge-mitsubishi-ac-au-nz.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-22%20%7C%2024-339933.svg" alt="Node.js"></a>
  <a href="https://homebridge.io/"><img src="https://img.shields.io/badge/homebridge-%3E%3D2.0-purple.svg" alt="Homebridge"></a>
  <a href="#features"><img src="https://img.shields.io/badge/HomeKit-AC-0f7fff.svg" alt="HomeKit AC"></a>
  <a href="docs/setup.md#network-notes"><img src="https://img.shields.io/badge/control-MELView%20%2B%20LAN-success.svg" alt="MELView assisted LAN"></a>
</p>

<p align="center">
  <img src="assets/homebridge-mitsubishi-ac-au-nz.png" alt="Homebridge Mitsubishi AC AU/NZ" width="320">
</p>

Bring your Mitsubishi Electric **Wi-Fi Control** air conditioners and heat pumps into Apple Home. Each unit appears as a native HomeKit heater-cooler with heat, cool, auto, fan speed, swing, and optional dry mode — and commands snap to their new state instantly rather than waiting on a poll.

A modernized fork of [`aurc/melview-mitsubishi-au-nz`](https://github.com/aurc/melview-mitsubishi-au-nz), rebuilt for Homebridge 2.0 with native fan/swing control, outdoor temperature, and a focus on responsiveness and reliability — see [what changed](docs/modernization.md).

> [!NOTE]
> **Region:** Built for Mitsubishi Electric units in Australia and New Zealand that pair with the **Mitsubishi Wi-Fi Control** app (MELView). If your unit shows up in that app, it's a good candidate.

## Features
- **Native heater-cooler tile** — power, heat/cool/auto (matched to each unit's real capabilities).
- **Fan speed** — slider steps matched to the unit's actual fan stages, with auto fan where supported.
- **Swing** — on/off for units that report it.
- **Target & room temperature** — within each unit's supported range (Celsius).
- **Outdoor temperature** *(optional)* — as a separate temperature-sensor tile.
- **Dry / dehumidifier mode** *(optional)*.
- **Snappy & resilient** — instant post-command refresh, staggered polling, and discovery that won't drop your accessories on a flaky response. [Details](docs/modernization.md#responsiveness--reliability).

No "pretend" fan accessory and no custom characteristics — only what Apple Home renders natively.

## Quick start
1. Install [Homebridge](https://homebridge.io/) `2.0+` on Node `22`/`24`.
2. In the Homebridge Config UI, install **`homebridge-mitsubishi-ac-au-nz`** and enter your MELView credentials.
3. Restart Homebridge.

Minimal `config.json`:

```json
{
  "platform": "MitsubishiAUNZ",
  "user": "user@example.com",
  "password": "your-password"
}
```

➡️ **Full options, network requirements, and troubleshooting: [Setup guide](docs/setup.md).**

## Documentation
- **[Setup guide](docs/setup.md)** — requirements, installation, all config options, network notes, troubleshooting, and local development.
- **[What changed vs the original](docs/modernization.md)** — how this fork differs from `aurc/melview-mitsubishi-au-nz`.
- **[Energy reporting notes](docs/energy-reporting.md)** — why energy isn't exposed yet and what would unblock it.

## Roadmap
- **Energy reporting** — not exposed yet. There's no clean native path today (HomeKit has no energy characteristic; iOS 27's Energy tab is Matter-based). Tracked in [docs/energy-reporting.md](docs/energy-reporting.md).

## Credits & license
Builds on [`aurc/melview-mitsubishi-au-nz`](https://github.com/aurc/melview-mitsubishi-au-nz) and the MELView reverse-engineering notes from [`NovaGL/diy-melview`](https://github.com/NovaGL/diy-melview). Licensed under [Apache-2.0](LICENSE).
