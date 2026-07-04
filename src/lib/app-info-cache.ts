export interface AppInfo {
  deviceSerial: string;
  packageName: string;
  label: string | null;
  iconBase64: string | null;
  versionCode: number;
  lastParsed: number;
}

export class AppInfoCache {
  private dbName: string;
  private storeName = 'app-info';
  private db: IDBDatabase | null = null;

  constructor(dbName: string = 'app-info-cache') {
    this.dbName = dbName;
  }

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 2); // 版本 1 → 2

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (event.oldVersion < 2) {
          if (db.objectStoreNames.contains(this.storeName)) {
            db.deleteObjectStore(this.storeName);
          }
          db.createObjectStore(this.storeName, {
            keyPath: ['deviceSerial', 'packageName']
          });
        }
      };
    });
  }

  async get(deviceSerial: string, packageName: string): Promise<AppInfo | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get([deviceSerial, packageName]);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  async set(deviceSerial: string, packageName: string, info: AppInfo): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(info);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async setAll(deviceSerial: string, infos: AppInfo[]): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      for (const info of infos) {
        store.put(info);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getAllForDevice(deviceSerial: string): Promise<AppInfo[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const request = store.getAll(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? []);
    });
  }

  async countForDevice(deviceSerial: string): Promise<number> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const request = store.count(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getCacheSizeForDevice(deviceSerial: string): Promise<number> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const cursor = store.openCursor(range);
      let totalSize = 0;
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        if (cursor.result) {
          totalSize += JSON.stringify(cursor.result.value).length;
          cursor.result.continue();
        } else {
          resolve(totalSize);
        }
      };
    });
  }

  async clearForDevice(deviceSerial: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const range = IDBKeyRange.bound(
        [deviceSerial, ''],
        [deviceSerial, '\uffff']
      );
      const request = store.delete(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async countAll(): Promise<number> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.count();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getTotalCacheSize(): Promise<number> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const cursor = store.openCursor();
      let totalSize = 0;
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        if (cursor.result) {
          totalSize += JSON.stringify(cursor.result.value).length;
          cursor.result.continue();
        } else {
          resolve(totalSize);
        }
      };
    });
  }

  async allDeviceSerials(): Promise<string[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const keys = (request.result as [string, string][]); // [serial, packageName][]
        const serials = [...new Set(keys.map(k => k[0]))];
        resolve(serials);
      };
    });
  }
}