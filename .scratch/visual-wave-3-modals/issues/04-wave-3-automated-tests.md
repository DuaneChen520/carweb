# Issue 04: Wave 3 自动化测试套件

Status: resolved
Type: task

## Comments

- `src/components/__tests__/ConnectionOverlay.test.tsx`：增补了语义 Token 与 48px 触控靶区（模式按钮、已配对设备、Tab 栏、主 CTA 等）的工效断言；
- 新增 `src/components/__tests__/AppPicker.test.tsx`：验证微毛玻璃浮窗材质渲染、顶栏 48x48px 触控控制组（置顶模式、刷新、关闭）以及置顶高亮切换；
- 新增 `src/components/__tests__/ModalDialogs.test.tsx`：覆盖 `CacheSettingsDialog`（微毛玻璃外框、48x48px 顶栏关闭按钮、`min-h-[44px]` 清除操作、`min-h-[48px]` 全量清除与关闭）与 `PinDialog`（48px 数字键盘与底部操作整行触控）；
- 全量测试（46 个套件、384 个测试用例）、`npm run check` 与 `npm run lint` 全部通过。
