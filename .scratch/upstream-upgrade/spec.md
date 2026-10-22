# Feature Spec: Upstream Dependency Upgrade and Stability Enhancements

## Problem Statement

CarWeb relies on `@yume-chan/*` (v3.0.0-beta.1) and `scrcpy` for core WebADB and display streaming capabilities. Over time, several upstream issues and feature gaps have directly degraded system stability and user experience:

1. **Local Patch Debt**: CarWeb currently relies on `patch-package` to fix two critical IndexedDB bugs in `@yume-chan/adb-credential-web` (handling of async callbacks and unreset database promises leading to `InvalidStateError`). Maintaining custom vendor patches carries long-term regression risks.
2. **Unhandled Promise Rejections on Disconnect**: When an ADB connection disconnects unexpectedly (e.g., unplugging USB, device crash, network drop), unhandled rejections originate from `@yume-chan/adb`'s internal `.finally()` chain.
3. **Silent Audio for Games and System Services**: In `--audio-dup` mode, scrcpy originally only captured players declaring `USAGE_MEDIA`. Android games (declaring `USAGE_GAME`) and non-media applications are completely muted in the car screen mirroring stream.
4. **Intrusive Screen Keeping**: Preventing the phone screen from sleeping during car projection currently requires modifying global device system settings, which fails to restore if disconnected unexpectedly.
5. **Encoder Crash During Dynamic Display Resize**: In multi-pane desktop mode, dynamically resizing virtual displays can hit strict video encoder size and alignment constraints on specific Android SoCs, crashing the scrcpy server.

## Solution

1. **Upgrade `@yume-chan/*` Suite to `3.0.0-beta.4`**:
   - Retire the local `patches/@yume-chan+adb-credential-web+3.0.0-beta.1.patch` once upstream PR #871 fixes the underlying transaction and IndexedDB connection reuse bug.
   - Benefit from upstream PR #863 preventing unhandled disconnect rejections.
   - Leverage native `NotFoundError` handling in `adb-daemon-webusb` for cleaner hotplug handling.
2. **Scrcpy Upstream Feature Integration (v4.1 - v5.0.1)**:
   - Configure `--audio-dup=all` (or flexible usage flags) to mirror game and navigation audio streams without muting.
   - Adopt `--keep-active` periodically signaling user activity on the device side without altering global system display sleep settings.
   - Integrate upstream display size constraints relaxation and alignment heuristics for flexible virtual displays.

## User Stories

1. As a car driver, I want game and navigation audio sounds to be forwarded through the car speakers alongside regular music, so that I don't experience unexpected audio silence while using car projection.
2. As a car driver, I want my phone screen to stay awake reliably while connected to CarWeb without modifying my phone's permanent system sleep timeout settings, so that my phone screen turns off normally after I exit the vehicle.
3. As a developer, I want to eliminate local `patch-package` patches on `@yume-chan/adb-credential-web`, so that CarWeb runs on standard upstream npm releases with lower maintenance burden.
4. As a developer, I want unexpected ADB disconnections (such as unplugging the USB cable) to terminate gracefully without unhandled promise rejections crashing the application context, so that the UI cleanly transitions to a disconnected state.
5. As a car driver, I want dynamic window resizing in multi-pane virtual display mode to not crash the video encoder, so that window adjustments are smooth and resilient across different Android phone chipsets.
6. As a user plugging in a USB cable, I want credential authentication and key retrieval from IndexedDB to work consistently on first load and subsequent reconnections, so that I do not see `InvalidStateError` or database blocked errors.
7. As a developer, I want all tests, type checks, and lint checks to pass after the package upgrades, ensuring zero regressions across `src/lib/` and `src/hooks/scrcpy/`.

## Implementation Decisions

- **Package Upgrades**:
  - Update all `@yume-chan/*` dependencies in `package.json` from `3.0.0-beta.1` to `3.0.0-beta.4`.
  - Remove `@yume-chan+adb-credential-web+3.0.0-beta.1.patch` if verified clean against upstream PR #871.
  - Review and retain or adjust `@yume-chan+adb-daemon-webusb+3.0.0-beta.1.patch` based on upstream `NotFoundError` coverage.
- **Session Layer Server Options (`ScrcpySession`)**:
  - Add optional `--audio-dup` parameter support accepting comma-separated usage values (defaulting to `all` or `media,game,voice-communication`).
  - Introduce `--keep-active` flag support when launching `ScrcpySession` to prevent device sleep non-intrusively.
  - Align video encoder constraint options with scrcpy 4.1+ behavior.
- **Error Handling Seam**:
  - Ensure disconnect handlers in connection management (`useUsbConnection`, `useWifiConnection`, and `useAdbStore`) gracefully accept the upstream disconnect rejection handling changes without bubbling to global window handlers.

## Testing Decisions

- **Behavioral Boundaries & Test Seams**:
  - Focus tests on external module behavior: connection state transitions, session start options assembly, and credential storage load/save behavior.
  - Verify `npm run test` (Vitest), `npm run check` (TypeScript `tsc -b --noEmit`), and `npm run lint` pass completely.
  - Existing credential storage and ADB connection tests in `src/` serve as primary test baselines.
- **Regression Verification**:
  - Test disconnect handling under simulated abrupt socket termination.
  - Test session initialization argument generation with `--audio-dup` and `--keep-active`.

## Out of Scope

- Migrating UI infrastructure to major versions (e.g. Vite 8, React 19, Tailwind v4).
- Rewriting the WebCodecs video rendering pipeline from scratch.
- Full server-side binary replacement on embedded targets outside standard Android adb push workflows.

## Further Notes

- The rollout is split into two phases:
  - Phase 1: Bump `@yume-chan/*` to `3.0.0-beta.4`, test IndexedDB credential storage, and remove obsolete patch files.
  - Phase 2: Expose and wire up the upstream scrcpy options (`--audio-dup=all`, `--keep-active`).
