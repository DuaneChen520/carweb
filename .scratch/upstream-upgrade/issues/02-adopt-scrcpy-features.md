# 02: Adopt scrcpy upstream features (--audio-dup=all, --keep-active, flex constraints)

**What to build:**
Expose upstream scrcpy server options in `ScrcpySession` for `--audio-dup=all` (allowing game and navigation audio to be forwarded without being dropped) and `--keep-active` (keeping the phone screen awake without mutating persistent Android system sleep settings). Align virtual display flex constraints with upstream heuristics.

**Blocked by:** 01: Upgrade @yume-chan dependencies to 3.0.0-beta.4 and eliminate obsolete patches

**Status:** ready-for-agent

- [ ] Add support for configurable `--audio-dup` usages (defaulting to include game/all audio) in `ScrcpySession`
- [ ] Add support for `--keep-active` flag in `ScrcpySession` launch arguments
- [ ] Add unit tests in `src/lib/` covering the new option builders
- [ ] Run `npm run test`, `npm run check`, and `npm run lint` with 100% pass rate
