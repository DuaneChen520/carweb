# Browser Keyboard Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser keyboard mode — capture car device IME input via transparent overlay, inject into phone via scrcpy.

**Architecture:** Two keyboard modes toggled by user setting. Phone keyboard mode (current) shows phone IME. Browser keyboard mode uses a transparent `<input>` over the canvas to capture browser IME, auto-injects on `compositionend`.

**Tech Stack:** React, scrcpy injectText, localStorage for persistence

---

### Task 1: Add keyboard mode state and setting

**Files:**
- Modify: `src/components/ControlSidebar.tsx`

- [ ] **Step 1: Add keyboard mode state to ControlSidebar**

Add `useState` for keyboard mode:
```typescript
const [keyboardMode, setKeyboardMode] = useState<'phone' | 'browser'>(() => {
  return (localStorage.getItem('carweb-keyboard-mode') as 'phone' | 'browser') || 'phone';
});
```

- [ ] **Step 2: Add keyboard mode toggle to settings panel**

Inside the settings panel (the `showSettings` block), add a toggle after the cache size display:
```tsx
<div className="flex items-center justify-between gap-3">
  <span>键盘模式</span>
  <button
    onClick={() => {
      const next = keyboardMode === 'phone' ? 'browser' : 'phone';
      setKeyboardMode(next);
      localStorage.setItem('carweb-keyboard-mode', next);
    }}
    className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
      keyboardMode === 'browser' ? 'bg-blue-500/30 text-blue-400' : 'bg-white/10 text-white/60'
    }`}
  >
    {keyboardMode === 'phone' ? '📱 手机' : '⌨️ 浏览器'}
  </button>
</div>
```

- [ ] **Step 3: Pass keyboardMode and setKeyboardMode to VirtualScreen**

Add `keyboardMode` and `setKeyboardMode` to the props passed from `VirtualScreen` to `ControlSidebar`. In `VirtualScreen.tsx`, add the state there and pass it down.

- [ ] **Step 4: Run typecheck**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ControlSidebar.tsx src/components/VirtualScreen.tsx
git commit -m "feat: add keyboard mode setting (phone/browser) with localStorage persistence"
```

---

### Task 2: Implement browser keyboard input overlay

**Files:**
- Modify: `src/components/VirtualScreen.tsx`

- [ ] **Step 1: Add transparent input overlay for browser keyboard mode**

After the `<canvas>` element (inside the container div), add:

```tsx
{showVirtualKeyboard && keyboardMode === 'browser' && (
  <input
    ref={browserInputRef}
    type="text"
    className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-default"
    style={{ caretColor: 'transparent' }}
    onCompositionEnd={(e) => {
      const text = e.data;
      if (text) {
        injectText(text);
      }
      // Clear the input for next composition
      if (browserInputRef.current) {
        browserInputRef.current.value = '';
      }
    }}
    onKeyDown={(e) => {
      // Handle non-composition keys
      if (e.key === 'Enter') {
        e.preventDefault();
        injectText('\n');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        // injectText handles empty string gracefully
      }
      // For regular characters, let them go through composition
    }}
  />
)}
```

- [ ] **Step 2: Add browserInputRef and auto-focus logic**

```typescript
const browserInputRef = useRef<HTMLInputElement>(null);

// Auto-focus browser input when keyboard mode is browser
useEffect(() => {
  if (showVirtualKeyboard && keyboardMode === 'browser' && browserInputRef.current) {
    browserInputRef.current.focus();
  }
}, [showVirtualKeyboard, keyboardMode]);
```

- [ ] **Step 3: Remove old web text input UI**

Delete the old keyboard input UI block (the `showVirtualKeyboard &&` block that renders the input + send button at the bottom of the screen, around line 462-484).

- [ ] **Step 4: Handle phone keyboard mode (no changes needed)**

Phone keyboard mode already works via `showKeyboard()`/`hideKeyboard()`. The `toggleVirtualKeyboard` callback already handles this correctly — it calls `showKeyboard()` when turning on and `hideKeyboard()` when turning off.

- [ ] **Step 5: Run typecheck**

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/VirtualScreen.tsx
git commit -m "feat: implement browser keyboard input overlay with compositionend injection"
```

---

### Task 3: Ensure keyboard input stays focused during interaction

**Files:**
- Modify: `src/components/VirtualScreen.tsx`

- [ ] **Step 1: Re-focus browser input after pointer events on canvas**

In the `handlePointerEvent` callback (or after canvas touch events), re-focus the browser input so keyboard events continue to be captured:

```typescript
// After touch/pointer events, re-focus browser input
if (showVirtualKeyboard && keyboardMode === 'browser' && browserInputRef.current) {
  // Use setTimeout to avoid interfering with the touch event
  setTimeout(() => browserInputRef.current?.focus(), 0);
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/VirtualScreen.tsx
git commit -m "fix: re-focus browser input after canvas pointer events"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run all checks**

```bash
npm run check && npm run lint && npm run test
```

- [ ] **Step 2: Manual test**

1. Open app, connect device, start virtual display
2. Default mode: 📱 手机 — click keyboard button → phone IME appears on virtual screen
3. Open settings → switch to ⌨️ 浏览器
4. Click keyboard button → phone IME hidden, transparent input overlay active
5. Type on car device keyboard → text appears in phone's text field
6. Type Chinese (pinyin) → composition completes → text auto-injects
7. Switch back to 📱 手机 → phone IME reappears
