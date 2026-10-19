# Readiness review — 19 October 2026

The local build is ready for a controlled first run. Automated checks cover the
plugin logic; pairing, physical operation, and Apple Home presentation still
need verification with your Homebridge host and Mitsubishi unit. These changes
are local and unreleased; installing the existing npm release does not include
them.

## What was fixed

- Corrected the one-, three-, and four-stage fan ladders against `fanStageInfo`
  in [Mitsubishi's Wi-Fi Control app](https://app.melview.net/js/ex.js), since
  confirmed verbatim against that bundle (`1: '5'`, `2: '25'`, `3: '235'`,
  `4: '2356'`, `5: '12356'`). The five-stage ladder was already correct. Fixed
  integer percentage rounding that could turn medium speed into high on a
  three-stage unit.
- Prevented an old status response from undoing a newly accepted command in
  Home. Polls pause while commands are pending.
- Clamped each temperature command to the mode the unit will actually run in,
  resolved after any queued mode change rather than from the setpoint Home
  wrote. Capability limits and whole/half-degree support now govern commands.
- Kept an enabled outdoor tile present when its first reading is missing,
  preserving room assignments and automation references across restarts.
- Fixed Max-Age session expiry and concurrent reauthentication. Invalid
  inventory, capabilities, login, and status response shapes now fail clearly,
  without rejecting payloads that merely differ in detail (numeric
  temperatures, or capabilities missing an optional field).
- Prevented discovery from scheduling retries after shutdown.
- Updated the vulnerable `brace-expansion` development dependency in the
  lockfile, and replaced `nodemon` with `tsc --watch` plus Node's built-in
  `--watch-path`, which removes the `nodemon → chokidar → braces` chain that
  carried the three remaining high-severity findings. Both the full and the
  production-only dependency audits now report no known vulnerabilities.

## First use

1. Use Homebridge 2.3+ with Matter enabled and Node 22 or 24, as required by
   this package. Confirm your units already work in the Mitsubishi Wi-Fi
   Control app. See [setup](setup.md) for Matter configuration and pairing.
2. Build and package this checkout with `npm ci`, `npm run build`, then
   `npm pack`. Install the resulting `.tgz` on the **Homebridge host**, for
   example `npm install -g /path/to/homebridge-mitsubishi-ac-au-nz-1.4.1.tgz`
   in its terminal. Use the host's normal plugin installation permissions.
   This package retains version 1.4.1; it is a local test build, not a new release.
3. Start with the following platform entry. A 30-second poll catches remote
   changes with fewer cloud requests; commands still update immediately.

   ```json
   {
     "platform": "MitsubishiAUNZ",
     "user": "your-melview-email",
     "password": "your-melview-password",
     "pollInterval": 30,
     "dry": false,
     "outdoorTemperature": false,
     "energy": false
   }
   ```

4. Pair the Matter bridge, then check power, heat/cool, target temperature,
   and each fan speed against the unit and Mitsubishi app. Change a setting
   with the remote and confirm Home refreshes within a poll cycle.
5. Restart Homebridge and confirm the same tiles remain and still accept
   commands. Then enable outdoor temperature and energy if wanted; enable
   experimental dry mode only after basic control works.

## Remaining limitations

- This is cloud-dependent. The LAN request accelerates accepted commands but
  cannot replace MELView authentication, discovery, and status polling.
- The plugin exposes Matter only. Migrating from its old HAP version removes
  old accessories and requires pairing and rebuilding affected automations.
- Native Auto mode and swing remain unavailable through this implementation.
  Energy is estimated/hourly, not a live wattage reading. Its ledger only
  fetches yesterday and today, so longer outages leave gaps. Date selection
  uses the Homebridge host timezone; use the unit's timezone on that host.
- No live MELView account, physical unit, or paired Apple Home controller was
  used for this review. Unit tests use stubbed network/Matter interfaces.

## Validation

72 tests pass on Node 24, including regression cases that failed before the
fixes; each of the four newest was confirmed to fail against the unfixed code.
A fresh `npm ci --ignore-scripts` in a temporary checkout also passes all 72
tests, ESLint, and TypeScript compilation. ESLint now covers `test/` as well as
`src/` and reports no warnings. `npm audit --omit=dev` reports zero
vulnerabilities, as does `npm audit` with development dependencies
included. The declared Node 22 target remains covered by the
repository's CI matrix, but was not run locally during this review.
