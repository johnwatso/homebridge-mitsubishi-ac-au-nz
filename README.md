<h1 align="center">Homebridge Mitsubishi AC AU/NZ</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-mitsubishi-ac-au-nz"><img src="https://img.shields.io/npm/v/homebridge-mitsubishi-ac-au-nz.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-22%20%7C%2024-339933.svg" alt="Node.js"></a>
  <a href="https://homebridge.io/"><img src="https://img.shields.io/badge/homebridge-%3E%3D2.0-purple.svg" alt="Homebridge"></a>
  <a href="#homekit-support"><img src="https://img.shields.io/badge/HomeKit-AC-0f7fff.svg" alt="HomeKit AC"></a>
  <a href="#network-notes"><img src="https://img.shields.io/badge/control-MELView%20%2B%20LAN-success.svg" alt="MELView assisted LAN"></a>
</p>

<p align="center">
  <img src="assets/homebridge-mitsubishi-ac-au-nz.png" alt="Homebridge Mitsubishi AC AU/NZ" width="320">
</p>

Homebridge plugin for Mitsubishi Electric Wi-Fi Control air conditioners and heat pumps in Australia and New Zealand. It publishes each unit as a **native Matter** air conditioner via Homebridge 2.0's Matter support, with controls for heat, cool, auto, fan speed, and optional dry mode.

> **Matter required.** This plugin no longer publishes via HAP. It uses Homebridge 2.0's Matter API, so you must enable a `matter` block on your bridge and pair the Matter bridge into Apple Home (or Google/Alexa/SmartThings). See [Configuration](#configuration) and [Migrating from the HAP version](#migrating-from-the-hap-version).

This project is a modernized fork of the original [`aurc/melview-mitsubishi-au-nz`](https://github.com/aurc/melview-mitsubishi-au-nz) plugin, updated for current Node/Homebridge versions and migrated to native Matter.

Published on npm as [`homebridge-mitsubishi-ac-au-nz`](https://www.npmjs.com/package/homebridge-mitsubishi-ac-au-nz).

## Modernization
This fork has been modernized for Homebridge 2.0 and newer Homebridge installations.

- Targets Homebridge `>=2.0.0` and Node.js `22` or `24`.
- Publishes each unit as a native Matter `RoomAirConditioner` through Homebridge 2.0's `api.matter`, instead of HAP.
- Registers Matter accessories once and restores them from cache cleanly; removes accessories when MELView no longer reports the unit (with a guard so a transient empty listing can't wipe them).
- Removes leftover HAP accessories from the previous version automatically on first launch.
- Refreshes the accessory immediately after each command (no waiting for the next poll), and staggers/relaxes polling to be gentle on the MELView API.
- Cleans up polling timers during Homebridge shutdown.
- Uses stricter TypeScript with current dependency versions, unit tests, and a refreshed lockfile.

## About
Homebridge Mitsubishi AC AU/NZ brings Mitsubishi Electric Wi-Fi Control air conditioners and heat pumps into Apple Home through Homebridge.

The plugin discovers units from your Mitsubishi Wi-Fi Control / MELView account and exposes each unit as a native Matter air conditioner with supported AC controls.

Day-to-day commands are MELView-assisted. The plugin authenticates with MELView, sends the command through MELView, and then uses the returned local command token to make a fast LAN request directly to the unit where available. This is not fully offline local control, but it can make commands feel much more responsive than cloud-only integrations.

## Supported Hardware
This plugin is intended for Mitsubishi Electric air conditioners and heat pumps in Australia and New Zealand that work with the Mitsubishi Electric **Wi-Fi Control** app.

Known working combinations from the original project:

| Indoor Unit | Wi-Fi Module |
| :--- | :--- |
| MSZ-GL71VGD | MAC-568IF-E |
| MSZ-GL35VGD | MAC-568IF-E |
| MSZ-AP25VGD | MAC-568IF-E |

If your unit appears in the Mitsubishi Wi-Fi Control app, it is a good candidate for this plugin.

## Apple Home (Matter) Support
- **Air Conditioner Accessory:** Appears as a native Matter `RoomAirConditioner` (Apple Home renders it as an AC/thermostat tile).
- **Power Control:** Turn units on and off.
- **Mode Control:** Heat, cool, and auto where supported by the unit (Matter Thermostat `systemMode`).
- **Fan Speed:** Set fan speed via the Matter FanControl cluster, including auto fan where supported.
- **Target Temperature:** Set the target temperature within the unit's supported range (Celsius internally; Apple Home displays your chosen units).
- **Room Temperature:** Reports the current room temperature from MELView.
- **Outdoor Temperature:** Optionally exposes MELView outdoor temperature as a separate Matter temperature-sensor tile.
- **Optional Dry Mode:** Maps to Matter Thermostat `SystemMode.Dry` when enabled and supported (best-effort — see Known Limitations).
- **State Updates:** Polls MELView so changes made outside Apple Home (e.g. the wall remote) are reflected back.
- **Multi-ecosystem:** Because it's Matter, the same accessory can be shared with Google Home, Alexa, and SmartThings.

The plugin sticks to native Matter device types — no custom characteristics.

## Installation
Install from npm: [homebridge-mitsubishi-ac-au-nz](https://www.npmjs.com/package/homebridge-mitsubishi-ac-au-nz)

1. Install Homebridge.
2. Search for `homebridge-mitsubishi-ac-au-nz` in Homebridge Config UI.
3. Install the plugin.
4. Enter your Mitsubishi Wi-Fi Control account credentials.
5. Restart Homebridge.

## Configuration
Add the following to your Homebridge `config.json`:

```json
{
  "platform": "MitsubishiAUNZ",
  "user": "user@example.com",
  "password": "your-password",
  "dry": false,
  "outdoorTemperature": false
}
```

| Setting | Required | Description |
| :--- | :--- | :--- |
| `platform` | Yes | Must be `MitsubishiAUNZ`. |
| `user` | Yes | Mitsubishi Wi-Fi Control / MELView account email. |
| `password` | Yes | Mitsubishi Wi-Fi Control / MELView account password. |
| `dry` | No | Set to `true` to map supported units' dry mode to Matter `SystemMode.Dry`. Defaults to `false`. |
| `outdoorTemperature` | No | Set to `true` to expose MELView outdoor temperature as a separate Matter temperature sensor when available. Defaults to `false`. |
| `pollInterval` | No | Seconds between MELView state refreshes (default `10`, range `5`–`120`). Commands update instantly, so this only catches changes made outside Apple Home. |

### Enabling Matter
This plugin publishes Matter accessories, so Matter must be enabled on the bridge it runs on. Add a `matter` block to the Homebridge **bridge** config (or to this plugin's **child bridge**). Homebridge then starts a Matter server and shows a pairing code in the log / Config UI — add that to Apple Home (or Google/Alexa/SmartThings) like any Matter accessory. See the [Homebridge Matter docs](https://github.com/homebridge-plugins/homebridge-matter/wiki/Enabling-Matter). Matter support in Homebridge 2.0 is still experimental.

### Migrating from the HAP version
Earlier versions of this plugin published over HAP. On first launch after upgrading, the plugin **removes its old HAP accessories automatically** and republishes each unit over Matter. Because Matter is a separate pairing, this is a **breaking change**: the old AC tiles disappear and you must pair the Matter bridge and re-add the units. Any room assignments, names, or automations that referenced the old HAP accessories will need to be set up again.

## Network Notes
This plugin is **not fully local-only**.

It uses MELView for login, discovery, status polling, and command authorization. For commands, it asks MELView for a local command token and then sends a follow-up request to the unit on your LAN:

```text
http://<unit-local-ip>/smart
```

For best results, your Homebridge host should be able to reach the Wi-Fi module's local IP address on your LAN. If your Homebridge host and heat pump are on different VLANs, allow traffic from Homebridge to the heat pump module.

## Known Limitations
- **Matter is experimental:** Homebridge 2.0's Matter support is still stabilising; behaviour may change with Homebridge updates.
- **Internet required:** MELView authentication is still required for normal operation.
- **Dry mode:** Best-effort. Maps to Matter `SystemMode.Dry`; how Apple Home renders it is not guaranteed across iOS versions.
- **Swing / vane direction:** Not exposed. Homebridge's Matter FanControl wrapper doesn't surface a swing (`rockSetting`) control handler, so swing was dropped in the Matter migration.
- **Outdoor temperature:** Optional and off by default; MELView data varies between units, so implausible/placeholder readings are hidden rather than shown.
- **Energy reporting:** Not exposed yet — see Roadmap.

## Roadmap
- **Energy reporting (coming soon):** Now that the plugin is on Matter, energy is the natural next step — iOS 27's native Apple Home **Energy** tab reads the Matter Electrical Power/Energy Measurement clusters. Two things still block it: (1) Homebridge 2.0's Matter API does not yet expose those electrical-measurement clusters to plugins, and (2) MELView's energy data source (units advertise `hasenergy`) is not yet confirmed. Units that advertise energy support are logged in the meantime. See [docs/energy-reporting.md](docs/energy-reporting.md).

## Development
Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run build
npm run lint
npm test
npm audit
```

For local Homebridge testing:

```bash
npm link
```

## Credits
This plugin builds on the original [`aurc/melview-mitsubishi-au-nz`](https://github.com/aurc/melview-mitsubishi-au-nz) project and the MELView reverse-engineering notes from [`NovaGL/diy-melview`](https://github.com/NovaGL/diy-melview).

## License
Apache-2.0
