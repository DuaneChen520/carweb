import { Adb, AdbServerClient } from '@yume-chan/adb';
import { AdbServerWebSocketConnector, type AdbServerConnectorOptions } from './adb-server-connector';

export interface IAdbWirelessService {
  /** 向手机无线调试配对端口发送配对码完成免线配对 */
  pair(address: string, code: string): Promise<void>;
  /** 与指定地址的 ADB 守护进程建立连接 */
  connect(address: string): Promise<void>;
  /** 断开与指定地址的连接 */
  disconnect(address: string): Promise<void>;
  /** 获取当前宿主识别到的所有设备 */
  getDevices(): Promise<AdbServerClient.Device[]>;
  /** 针对指定设备创建标准 Adb 客户端 */
  createAdb(device: AdbServerClient.DeviceSelector): Promise<Adb>;
}

export class AdbServerManager implements IAdbWirelessService {
  private readonly client: AdbServerClient;

  constructor(connectorOrOptions?: AdbServerClient.ServerConnector | AdbServerConnectorOptions) {
    if (connectorOrOptions && typeof (connectorOrOptions as AdbServerClient.ServerConnector).connect === 'function') {
      this.client = new AdbServerClient(connectorOrOptions as AdbServerClient.ServerConnector);
    } else {
      this.client = new AdbServerClient(
        new AdbServerWebSocketConnector(connectorOrOptions as AdbServerConnectorOptions | undefined),
      );
    }
  }

  /**
   * Android 11+ 原生配对：向手机无线调试配对端口发送 6 位配对码。
   *
   * @param address 形如 "192.168.1.100:37123" 的手机配对地址
   * @param code 手机屏幕上显示的 6 位配对数字
   */
  async pair(address: string, code: string): Promise<void> {
    await this.client.wireless.pair(address, code);
  }

  /**
   * 连接到指定设备的 ADB 调试端口。
   *
   * @param address 形如 "192.168.1.100:5555" 或 "192.168.1.100" 的地址
   */
  async connect(address: string): Promise<void> {
    await this.client.wireless.connect(address);
  }

  /**
   * 断开与目标地址的 ADB 连接。
   */
  async disconnect(address: string): Promise<void> {
    await this.client.wireless.disconnect(address);
  }

  /**
   * 查询当前宿主 ADB 识别到的所有设备列表。
   */
  async getDevices(): Promise<AdbServerClient.Device[]> {
    return await this.client.getDevices();
  }

  /**
   * 为指定设备创建标准 Adb 实例，用于后续启动 scrcpy 会话和虚拟屏。
   */
  async createAdb(device: AdbServerClient.DeviceSelector): Promise<Adb> {
    return await this.client.createAdb(device);
  }

  /** 获取底层 AdbServerClient 原生实例 */
  get rawClient(): AdbServerClient {
    return this.client;
  }
}
