# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.3.0]: https://github.com/johnwatso/homebridge-mitsubishi-ac-au-nz/releases/tag/v1.3.0
