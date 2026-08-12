# Setup guide

Full installation, configuration, and troubleshooting for **homebridge-mitsubishi-ac-au-nz**, which publishes each Mitsubishi unit as a **native Matter** air conditioner. For an overview see the [README](../README.md); for how this fork differs from the original see [modernization](modernization.md).

## Contents
- [Requirements](#requirements)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Enabling Matter](#enabling-matter)
- [Configuration](#configuration)
- [Migrating from the HAP version](#migrating-from-the-hap-version)
- [Known limitations](#known-limitations)
- [Network notes](#network-notes)
- [Troubleshooting](#troubleshooting)
- [Local development](#local-development)

## Requirements
- **Homebridge** `>= 2.0.0` with **Matter enabled** on the bridge this plugin runs on (see [Enabling Matter](#enabling-matter))
- **Node.js** `22` or `24`
- A **Mitsubishi Wi-Fi Control / MELView** account with your units already added in the app
- Network reachability from the Homebridge host to each unit's LAN IP (see [Network notes](#network-notes))

> [!NOTE]
> Capabilities (modes, fan stages, dry) are read per-unit from MELView, so the controls you see match what each unit actually supports. Known-working hardware includes MSZ-GL71VGD, MSZ-GL35VGD, and MSZ-AP25VGD with the MAC-568IF-E Wi-Fi module; other models in the Wi-Fi Control app are likely to work too.

## How it works
Control is **MELView-assisted with a local fast path**. For each command the plugin:

1. Authenticates with your MELView account and sends the command through MELView.
2. Receives a local command token in the response.
3. Fires a direct LAN request to the unit's Wi-Fi module using that token:

   ```text
   http://<unit-local-ip>/smart
   ```

This isn't fully offline local control — MELView is still used for login, discovery, and authorization — but the LAN hop makes commands feel far snappier than cloud-only integrations, and the plugin applies the unit's returned state immediately so the tile reflects reality without waiting for the next poll.

The plugin exposes each unit as a Matter `RoomAirConditioner` (OnOff + Thermostat + FanControl), plus an optional `TemperatureSensor` for outdoor temperature.

## Installation
**Config UI (recommended)**
1. Install [Homebridge](https://homebridge.io/) `2.0+`.
2. Search for **`homebridge-mitsubishi-ac-au-nz`** and install it.
3. Enter your Mitsubishi Wi-Fi Control account credentials.
4. [Enable Matter](#enabling-matter) and restart Homebridge.

**Command line**
```bash
npm install -g homebridge-mitsubishi-ac-au-nz
```

## Enabling Matter
This plugin publishes Matter accessories, so Matter must be enabled on the bridge it runs on. If it isn't, the plugin logs `Matter is not enabled for this bridge…` and exposes nothing.

1. Add a `matter` block to the Homebridge **bridge** config (or to this plugin's **child bridge** via its `_bridge` settings). Homebridge then starts a Matter server.
2. Restart Homebridge. A **Matter pairing code** appears in the Homebridge log and Config UI.
3. Add that code to Apple Home (or Google Home / Alexa / SmartThings) like any Matter accessory.

See the [Homebridge Matter docs](https://github.com/homebridge-plugins/homebridge-matter/wiki/Enabling-Matter). Matter support in Homebridge 2.0 is still **experimental**.

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
| `dry` | No | `false` | Map supported units' dry mode to Matter `SystemMode.Dry` (best-effort; see [Known limitations](#known-limitations)). |
| `outdoorTemperature` | No | `false` | Expose MELView outdoor temperature as a separate Matter temperature sensor when available. |
| `pollInterval` | No | `10` | Seconds between MELView state refreshes (range `5`–`120`). Commands update instantly, so this only catches changes made outside Apple Home (e.g. the wall remote). Higher is gentler on the MELView API. |

> [!TIP]
> **Outdoor temperature tile:** Apple Home pools every temperature sensor in a room into that room's climate summary. If the outdoor sensor sits in the same room as the indoor unit, it pulls that room's average toward the outdoor reading. Assign the outdoor tile to a different room if that bothers you — the AC's own current-temperature reading is unaffected either way.

## Migrating from the HAP version
Earlier versions of this plugin published over HAP. On the first launch after upgrading, the plugin **removes its old HAP accessories automatically** and republishes each unit over Matter.

> [!IMPORTANT]
> Because Matter is a separate pairing, this is a **breaking change**: the old AC tiles disappear and you must pair the Matter bridge and re-add the units. Room assignments, names, and automations that referenced the old HAP accessories need to be set up again.

## Known limitations
- **Matter is experimental** — Homebridge 2.0's Matter support is still stabilising; behaviour may change with Homebridge updates.
- **Swing / vane direction is not exposed** — Homebridge's Matter FanControl wrapper has no swing (`rockSetting`) control handler, so swing was dropped in the Matter migration.
- **Dry mode is best-effort** — maps to Matter `SystemMode.Dry`; how Apple Home renders it is not guaranteed across iOS versions.
- **Energy reporting is not exposed** — see [energy-reporting.md](energy-reporting.md).
- **Internet required** — MELView authentication is needed for normal operation; this is not offline-only control.

## Network notes
> [!IMPORTANT]
> This plugin is **not fully local-only.** It uses MELView for login, discovery, status polling, and command authorization; only the per-command follow-up goes directly to the unit over your LAN.

For best results, the Homebridge host should be able to reach each Wi-Fi module's local IP. If Homebridge and your heat pumps are on different VLANs, allow traffic from Homebridge to the modules.

## Troubleshooting
- **`Matter is not enabled for this bridge`** — add a `matter` block to the bridge (or child bridge) this plugin runs on; see [Enabling Matter](#enabling-matter).
- **The AC doesn't appear after pairing** — confirm the Homebridge Matter bridge is paired into your ecosystem, and that the log shows `Adding new Matter accessory`. Give it a moment to publish.
- **"Plugin has not been configured"** — add your MELView `user` and `password` in the plugin config.
- **"Unable to refresh … from MELView" / "Unable to access unit via direct LAN interface"** — usually network reachability: confirm the Homebridge host can reach the unit's LAN IP, and check VLAN/firewall rules. Cloud-only operation still works without the LAN path, just less snappily. The message names the cause (HTTP status, or a timeout).
- **Login fails / auth token errors** — verify the credentials work in the Mitsubishi Wi-Fi Control app; you may need to reset your password with Mitsubishi. The session is refreshed automatically before it expires, and re-established once if MELView rejects it mid-session, so a bridge restart shouldn't be needed.
- **A unit disappeared** — the plugin only removes accessories MELView genuinely stops reporting; a one-off empty/erroring response is ignored. If a unit was removed in MELView, it is removed here too.
- **More detail** — enable Homebridge debug logging (`-D`) to see per-command and per-poll diagnostics.

## Local development
```bash
npm install      # install dependencies
npm run build    # compile TypeScript to dist/
npm run lint     # eslint (zero warnings)
npm test         # unit tests (node:test)
npm audit        # dependency audit
npm link         # symlink for local Homebridge testing
```

After `npm link`, Homebridge loads the plugin from your working tree. Homebridge runs the compiled `dist/`, so re-run `npm run build` after source edits and restart Homebridge. Tests cover the pure mapping logic (fan-stage mapping, MELView↔Matter mapping, setpoint clamping, command-response merging) and the MELView client (session handling, retries, error reporting) against a stubbed `fetch`; please keep `build`, `lint`, and `test` green.
