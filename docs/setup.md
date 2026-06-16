# Setup guide

Full installation, configuration, and troubleshooting for **homebridge-mitsubishi-ac-au-nz**. For an overview see the [README](../README.md); for how this fork differs from the original see [modernization](modernization.md).

## Contents
- [Requirements](#requirements)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Configuration](#configuration)
- [Network notes](#network-notes)
- [Troubleshooting](#troubleshooting)
- [Local development](#local-development)

## Requirements
- **Homebridge** `>= 2.0.0`
- **Node.js** `22` or `24`
- A **Mitsubishi Wi-Fi Control / MELView** account with your units already added in the app
- Network reachability from the Homebridge host to each unit's LAN IP (see [Network notes](#network-notes))

> [!NOTE]
> Capabilities (modes, fan stages, swing, dry) are read per-unit from MELView, so the controls you see match what each unit actually supports. Known-working hardware includes MSZ-GL71VGD, MSZ-GL35VGD, and MSZ-AP25VGD with the MAC-568IF-E Wi-Fi module; other models in the Wi-Fi Control app are likely to work too.

## How it works
Control is **MELView-assisted with a local fast path**. For each command the plugin:

1. Authenticates with your MELView account and sends the command through MELView.
2. Receives a local command token in the response.
3. Fires a direct LAN request to the unit's Wi-Fi module using that token:

   ```text
   http://<unit-local-ip>/smart
   ```

This isn't fully offline local control — MELView is still used for login, discovery, and authorization — but the LAN hop makes commands feel far snappier than cloud-only integrations, and the plugin applies the unit's returned state immediately so the tile reflects reality without waiting for the next poll.

## Installation
**Config UI (recommended)**
1. Install [Homebridge](https://homebridge.io/).
2. Search for **`homebridge-mitsubishi-ac-au-nz`** and install it.
3. Enter your Mitsubishi Wi-Fi Control account credentials.
4. Restart Homebridge.

**Command line**
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

> [!TIP]
> **Outdoor temperature tile:** Apple Home pools every temperature sensor in a room into that room's climate summary. If the outdoor sensor sits in the same room as the indoor unit, it pulls that room's average toward the outdoor reading. Assign the outdoor tile to a different room if that bothers you — the AC's own current-temperature reading is unaffected either way.

## Network notes
> [!IMPORTANT]
> This plugin is **not fully local-only.** It uses MELView for login, discovery, status polling, and command authorization; only the per-command follow-up goes directly to the unit over your LAN.

For best results, the Homebridge host should be able to reach each Wi-Fi module's local IP. If Homebridge and your heat pumps are on different VLANs, allow traffic from Homebridge to the modules.

## Troubleshooting
- **"Plugin has not been configured"** — add your MELView `user` and `password` in the plugin config.
- **"Unable to find accessory status" / "Unable to access unit via direct LAN interface"** — usually network reachability: confirm the Homebridge host can reach the unit's LAN IP, and check VLAN/firewall rules. Cloud-only operation still works without the LAN path, just less snappily.
- **Login fails / auth token errors** — verify the credentials work in the Mitsubishi Wi-Fi Control app; you may need to reset your password with Mitsubishi.
- **A unit disappeared from Home** — the plugin only removes accessories MELView genuinely stops reporting; a one-off empty/erroring response is ignored. If a unit was removed in MELView, it is removed here too.
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

After `npm link`, Homebridge loads the plugin from your working tree. Homebridge runs the compiled `dist/`, so re-run `npm run build` after source edits and restart Homebridge. Tests cover the pure mapping logic (fan-stage mapping, command-response merging); please keep `build`, `lint`, and `test` green.
