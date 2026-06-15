<h1 align="center">Homebridge Mitsubishi AC AU/NZ</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-mitsubishi-ac-au-nz"><img src="https://img.shields.io/npm/v/homebridge-mitsubishi-ac-au-nz.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D18.15-339933.svg" alt="Node.js"></a>
  <a href="https://homebridge.io/"><img src="https://img.shields.io/badge/homebridge-%3E%3D1.8-purple.svg" alt="Homebridge"></a>
  <a href="#homekit-support"><img src="https://img.shields.io/badge/HomeKit-AC%20%2B%20fan-0f7fff.svg" alt="HomeKit AC and fan"></a>
  <a href="#network-notes"><img src="https://img.shields.io/badge/control-MELView%20%2B%20LAN-success.svg" alt="MELView assisted LAN"></a>
</p>

<p align="center">
  <img src="assets/homebridge-mitsubishi-ac-au-nz.png" alt="Homebridge Mitsubishi AC AU/NZ" width="320">
</p>

Homebridge plugin for Mitsubishi Electric Wi-Fi Control air conditioners and heat pumps in Australia and New Zealand, with native-feeling HomeKit controls for heat, cool, auto, fan speed, swing, and optional dry mode.

This project is a modernized fork of the original [`aurc/melview-mitsubishi-au-nz`](https://github.com/aurc/melview-mitsubishi-au-nz) plugin, updated for current Node/Homebridge versions and expanded HomeKit support.

Published on npm as [`homebridge-mitsubishi-ac-au-nz`](https://www.npmjs.com/package/homebridge-mitsubishi-ac-au-nz).

## About
Homebridge Mitsubishi AC AU/NZ brings Mitsubishi Electric Wi-Fi Control air conditioners and heat pumps into Apple Home through Homebridge.

The plugin discovers units from your Mitsubishi Wi-Fi Control / MELView account, exposes each unit as a HomeKit heater-cooler accessory, and adds supported fan controls so the Home app feels closer to a native AC controller.

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

## HomeKit Support
- **Heater/Cooler Accessory:** Appears in Apple Home as a HomeKit heater-cooler service.
- **Power Control:** Turn units on and off.
- **Mode Control:** Heat, cool, and auto where supported by the unit.
- **Fan-Only Mode:** Exposes fan-only operation as a linked HomeKit fan service.
- **Fan Speed:** Set fan speed from Apple Home, including auto fan where supported.
- **Swing:** Toggle swing for units that report swing support through MELView.
- **Target Temperature:** Set heating and cooling target temperatures using the unit's supported ranges.
- **Room Temperature:** Reports the current room temperature from MELView.
- **Optional Dry Mode:** Can expose dry/dehumidifier mode when enabled in config and supported by the unit.
- **State Updates:** Polls MELView so changes made outside HomeKit are reflected back into Apple Home.
- **Siri, Scenes, and Automations:** Works with standard Apple Home automations through Homebridge.

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
  "dry": false
}
```

| Setting | Required | Description |
| :--- | :--- | :--- |
| `platform` | Yes | Must be `MitsubishiAUNZ`. |
| `user` | Yes | Mitsubishi Wi-Fi Control / MELView account email. |
| `password` | Yes | Mitsubishi Wi-Fi Control / MELView account password. |
| `dry` | No | Set to `true` to expose supported units as a HomeKit dehumidifier service. Defaults to `false`. |

Keep the Mitsubishi platform on the main bridge unless you specifically want it isolated. No child bridge is required.

## Network Notes
This plugin is **not fully local-only**.

It uses MELView for login, discovery, status polling, and command authorization. For commands, it asks MELView for a local command token and then sends a follow-up request to the unit on your LAN:

```text
http://<unit-local-ip>/smart
```

For best results, your Homebridge host should be able to reach the Wi-Fi module's local IP address on your LAN. If your Homebridge host and heat pump are on different VLANs, allow traffic from Homebridge to the heat pump module.

## Known Limitations
- **Internet required:** MELView authentication is still required for normal operation.
- **Dry mode:** Optional and less thoroughly tested than heat/cool/fan.
- **Swing:** Exposed only for units that report swing support through MELView.
- **Vane direction:** Currently exposed as swing on/off, not precise vertical or horizontal vane positions.
- **Outdoor temperature:** Not exposed yet; MELView data varies between units.

## Development
Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run build
npm run lint
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
