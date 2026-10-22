# 01: Upgrade @yume-chan dependencies to 3.0.0-beta.4 and eliminate obsolete patches

**What to build:**
Upstream `@yume-chan/ya-webadb` has released `v3.0.0-beta.4`, containing official fixes for IndexedDB credential management (PR #871) and unhandled promise rejection on disconnect (PR #863). Upgrade all `@yume-chan/*` packages to `3.0.0-beta.4`, eliminate obsolete local patch files, verify WebUSB error handling, and ensure the entire test suite and type check remain green.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Update `@yume-chan/*` dependencies in `package.json` to `3.0.0-beta.4`
- [ ] Remove `patches/@yume-chan+adb-credential-web+3.0.0-beta.1.patch` and verify clean postinstall
- [ ] Verify `patches/@yume-chan+adb-daemon-webusb+3.0.0-beta.1.patch` against upstream behavior
- [ ] Run `npm run test`, `npm run check`, and `npm run lint` with 100% pass rate
