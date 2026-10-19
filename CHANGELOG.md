# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-10-19

### Fixed
- New accessories use a readable MELView room/unit name, falling back to
  "Heat Pump" when Mitsubishi supplies a MAC address or unit ID as the default name.
  Outdoor sensors use the same name with "Outdoor" appended.
- Fan codes for one-, three-, and four-stage units now match Mitsubishi's
  Wi-Fi Control app. Rounded Matter percentages round-trip without jumping
  speeds, and units without auto fan use their lowest speed for 0%.
- Slow status polls no longer overwrite newer accepted commands; polling
  pauses while commands are queued.
- Temperature writes are clamped to the limits of the mode the unit will
  actually run in, resolved after any queued mode change rather than from the
  setpoint Home happened to write. Capability-supplied limits and whole/
  half-degree support are honoured, and a heating target above the cooling
  maximum is no longer displayed too low.
- An enabled outdoor sensor keeps its identity when a startup reading is
  missing, reporting an unknown temperature until readings resume.
- Max-Age cookies expire relative to creation; late failures from old sessions
  no longer discard a newer login. Invalid JSON response shapes are rejected
  before replacing state or processing the accessory inventory, while
  temperatures reported as numbers and capabilities with optional fields
  missing are still accepted. A capabilities payload without a fan stage count
  falls back to the one in the status response instead of assuming five.
- Discovery cannot schedule new retry/poll timers after shutdown.
- Updated the locked development dependency `brace-expansion` to 5.0.12 and
  synchronised the lockfile's Homebridge engine requirement.

### Changed
- Replaced the `nodemon` development dependency with `tsc --watch` and Node's
  built-in `--watch-path`, removing the last dependency chain flagged by
  `npm audit`. `npm run watch` behaves as before: it builds, links, then
  recompiles and restarts Homebridge (`-I -D`) on every source edit.
- Commands for each unit are now sent in order, so closely grouped Matter writes
  cannot race each other.
- A failed or MELView-rejected command no longer mutates the cached accessory
  state as though the unit accepted it.
- Direct LAN follow-up requests now report non-success HTTP responses as
  failures instead of logging them as successful.
- A malformed login response no longer leaves behind an auth cookie that makes
  the next discovery attempt skip login.
- Setup and modernization docs now consistently state the Homebridge 2.3+
  requirement and document the shipped energy option.

## [1.4.1] - 2026-09-15

### Fixed
- **The air conditioner failed to register with Matter**, so it didn't appear
  in Home ("Behaviors have errors"). Homebridge's Matter air conditioner has a
  thermostat without the AutoMode feature and a fan without the Auto feature.
  The plugin set `minSetpointDeadBand`, `thermostatRunningMode`, the Auto
  system mode, the Auto fan mode and the `OffLowMedHighAuto` fan sequence,
  all of which Matter rejects without those features. They're no longer set:
  - a unit running in auto shows as heating or cooling
  - auto fan is shown as 0%, and setting 0% selects it

  Checked against Homebridge 2.4's registration pipeline with matter.js for
  every mode, fan and capability combination.

## [1.4.0] - 2026-09-15

### Added
- **Energy reporting for iOS 27+ Apple Home.** Units with MELView Energy
  Monitoring now publish cumulative energy (the Matter Electrical Energy
  Measurement cluster) from MELView's hourly `energyreport.aspx` data. The
  total is persisted per unit so it survives restarts. Turn it off with the new
  `energy` option. An AC that's already paired may only show energy after a
  second Homebridge restart, once the new cluster is in the Matter cache.

### Fixed
- **Home commands work again after a restart on Homebridge 2.3+.** Cached
  accessories were passed to `updatePlatformAccessories`, which only merges
  metadata. Homebridge 2.3+ restores cached accessories with placeholder
  handlers and expects them to be registered again, so commands from Home were
  never attached. Every discovered accessory is now registered, which attaches
  the handlers to the restored endpoint without re-pairing.
- **Recovers when MELView is unreachable at startup.** Discovery used to run
  once, so a bridge that booted before the internet was up (e.g. after a power
  cut) stayed unresponsive until restarted. Discovery now retries with backoff
  (30s, doubling to 10 minutes).
- **A unit that briefly fails to set up is no longer removed from Home.** On
  multi-unit accounts its accessories were treated as stale and unregistered,
  losing its room, scenes and automations. It's now kept and retried.
- **Polls no longer overlap, and outages don't flood the log.** A slow MELView
  reply can't stack polls on top of each other. A failing unit logs one error,
  then a message when MELView is reachable again, instead of an error every
  poll.

### Changed
- **Requires Homebridge 2.3.0 or later** for the Matter electrical measurement
  clusters.

## [1.3.0] - 2026-08-13

First release of the fork since the HAP→Matter migration. No configuration
changes are required to upgrade.

### Fixed
- **The MELView session is now actually refreshed.** `authWillExpire()` compared
  `Cookie.expiryTime()` — an absolute timestamp — against zero, so it was always
  false and the auth token was never renewed. Once MELView expired the cookie,
  every poll failed with "Unable to find accessory status" until Homebridge was
  restarted. The session is now refreshed five minutes ahead of expiry, and
  re-established once if MELView rejects it mid-session (it answers an expired
  session with an HTML login page under a 200 rather than a 401).
- **The auth cookie is parsed correctly.** It was read from a JSON-stringified
  array of headers, which produced the cookie key `["auth`. Each `Set-Cookie`
  header is now parsed individually.
- **Thermostat updates are no longer silently dropped.** MELView's single
  setpoint was written to both the Matter heating and cooling attributes without
  clamping, so a heat-mode setpoint below the cooling minimum raised a
  `ConstraintError` that discarded the whole thermostat update — including mode
  and room temperature. Each setpoint is now clamped into its own range.
- **Requests can no longer hang or fail opaquely.** All MELView calls now have
  timeouts (15s cloud, 2s LAN), check the HTTP status, and report a named cause
  instead of throwing a `SyntaxError` from parsing an error page as JSON.
- **The LAN shortcut is skipped when no local IP is known**, instead of
  requesting `http://undefined/smart`.

### Added
- **The `dry` config option now works.** It was documented but read by nothing.
  Dry mode is accepted when the unit reports `hasdrymode` *and* the option is
  enabled, as the setup guide already described.
- **Mode requests are matched to the unit.** `hasautomode`, `hasdrymode` and
  `hascoolonly` gate inbound mode changes, so a mode the hardware can't do is
  refused and the real state is pushed back rather than sent as a command the
  unit ignores.
- Tests for the MELView client (session handling, retry behaviour, error
  reporting) against a stubbed `fetch`, and a parity test pinning the
  hand-written Matter enum values to the spec definitions. 19 tests to 38.

### Changed
- Cluster state is typed with Homebridge's exported `ThermostatState` and
  `FanControlState`, so a mistyped attribute name is a compile error rather than
  a silent no-op.
- Fan changes send the MELView fan code directly instead of round-tripping
  through a slider percentage.
- Discovery no longer logs in twice at startup, and failures report their cause.
- CI runs on Node 22/24 and actually runs the test suite; the release job runs
  on a Node version where `prepublishOnly` can succeed. Both previously could
  not have passed.
- Dropped `node-fetch` in favour of Node's global `fetch`; moved to ESLint 10
  flat config.
- The published tarball is now an explicit allowlist, so local editor settings
  and test sources are no longer shipped.

## [1.2.6] and earlier

Not published to npm. See the
[commit history](https://github.com/johnwatso/homebridge-mitsubishi-ac-au-nz/commits/main)
and [what changed vs the original](docs/modernization.md) for the fork's
Homebridge 2.0 modernisation and the HAP→Matter migration.

[1.5.0]: https://github.com/johnwatso/homebridge-mitsubishi-ac-au-nz/releases/tag/v1.5.0
[1.4.1]: https://github.com/johnwatso/homebridge-mitsubishi-ac-au-nz/releases/tag/v1.4.1
[1.4.0]: https://github.com/johnwatso/homebridge-mitsubishi-ac-au-nz/releases/tag/v1.4.0
[1.3.0]: https://github.com/johnwatso/homebridge-mitsubishi-ac-au-nz/releases/tag/v1.3.0
