/**
 * 分屏桌面状态持久化 Store。
 *
 * 沿用项目现有 IndexedDB 模式（参考 device-apps-store.ts），
 * 以 `deviceSerial` 为主键实现多设备天然隔离。
 *
 * 设计要点（见 docs/plans/2026-07-05-split-desktop-design.md §8）：
 * - 只记 pane 布局（paneLeft / paneRight 的 packageName），不记全屏和后台
 * - 全屏是临时态，后台 app 在设备重启后不可靠恢复
 * - pane 是用户"留下的桌面布局"，最该恢复
 */

export interface DesktopState {
  /** 设备序列号，主键，多设备隔离 */
  deviceSerial: string;
  /** 左 pane 的 packageName，null 表示空 pane */
  paneLeft: string | null;
  /** 右 pane 的 packageName，null 表示空 pane */
  paneRight: string | null;
  /** 写入时间戳（ms） */
  savedAt: number;
}

const DB_NAME = 'carweb-desktop-state';
const STORE_NAME = 'desktop';
const DB_VERSION = 1;

export class DesktopStateStore {
  private db: IDBDatabase | null = null;

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'deviceSerial' });
        }
      };
    });
  }

  /** 读取指定设备的分屏状态。不存在返回 null。 */
  async get(deviceSerial: string): Promise<DesktopState | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(deviceSerial);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  /** 写入（或覆盖）指定设备的分屏状态。 */
  async set(state: DesktopState): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(state);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
    });
  }

  /** 清除指定设备的分屏状态。 */
  async clear(deviceSerial: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(deviceSerial);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
    });
  }

  /** 清除所有设备的分屏状态。 */
  async clearAll(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
    });
  }
}
