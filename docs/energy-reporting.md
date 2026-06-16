# Energy reporting — research & design notes

Status: **groundwork only. Not implemented.** Last reviewed: 2026-06-16.

## Goal

Surface the AC's energy usage in a way that stays "fully Apple-native" — i.e. only
if/when Apple Home itself can render it, not via custom characteristics that only
appear in third-party apps (Eve/Controller). See the project's
"Apple-native north star".

## What iOS 26's energy feature actually is

The iOS 26 energy work is **EnergyKit**
(<https://developer.apple.com/energykit/>), announced alongside iOS 26. Key points:

- EnergyKit is an **app-layer framework** for *load shifting* and consumption
  *insight* — Grid Forecast (cleaner / cheaper electricity windows), focused on
  the two biggest home loads: HVAC and EV charging.
- It is **not** a new HomeKit Accessory Protocol (HAP) characteristic that a
  bridged accessory (like this Homebridge plugin) publishes and Apple Home draws
  on the AC tile.
- As of this writing there is **no public native HAP "energy consumption"
  characteristic on `HeaterCooler`** that Apple Home renders from a bridge.

**Implication:** we cannot make the AC tile show energy "natively" today without
inventing a custom characteristic — which is the exact "pretend" pattern this
project avoids. So energy stays groundwork until a real native surface exists.

## Open questions to resolve before implementing

1. **MELView data source.** MELView capabilities include `hasenergy`, but the
   current `State` / `CommandResponse` payloads carry no energy figures, and we
   have no known MELView energy endpoint. Confirm by capturing the Mitsubishi
   Wi-Fi Control app traffic: is there an energy/history endpoint, what does it
   return (instantaneous W? kWh totals? runtime minutes?), and at what cadence.
2. **Native surface.** Determine the actual accessory-published path Apple
   accepts for energy that feeds Home/EnergyKit (likely via Matter Electrical
   Energy/Power Measurement clusters rather than classic HAP). Confirm whether
   Homebridge can bridge that, or whether it requires Matter.app / a Matter
   bridge.
3. **Units & semantics.** Decide what we'd report (live power vs cumulative
   energy vs runtime) and reconcile MELView's granularity with whatever the
   native surface expects.

## Current code touchpoints

- `Capabilities.hasenergy` (src/data.ts) — already present.
- `platformAccessory.ts` logs `ENERGY Capability` when a unit advertises
  `hasenergy === 1`, so users can see which units report support. No service or
  characteristic is registered.

## Decision

Hold implementation until (1) the MELView energy API is confirmed and (2) a
genuinely native Apple Home surface exists. Revisit when iOS/Matter exposes an
accessory-published energy path that Homebridge can bridge.
