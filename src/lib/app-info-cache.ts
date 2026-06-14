export interface AppInfo {
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
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'packageName' });
        }
      };
    });
  }

  async get(packageName: string): Promise<AppInfo | null> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(packageName);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result ?? null);
      };
    });
  }

  async set(packageName: string, info: AppInfo): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(info);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async invalidate(packageName: string): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(packageName);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async count(): Promise<number> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.count();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getAllPackageNames(): Promise<string[]> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as string[]);
    });
  }

  async clear(): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getCacheSize(): Promise<number> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const cursor = store.openCursor();
      let totalSize = 0;

      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const result = cursor.result;
        if (result) {
          const value = result.value;
          totalSize += JSON.stringify(value).length;
          result.continue();
        } else {
          resolve(totalSize);
        }
      };
    });
  }
}
