import { describe, it, expect } from 'vitest';
import { parseAdbQrCode, isValidIpAddress, isValidPort } from '../adb-pairing';

describe('parseAdbQrCode', () => {
  it('解析有效的 ADB QR 码', () => {
    const result = parseAdbQrCode('WIFI:T:ADB;S:SM-G998B;P:123456;H:192.168.1.100;D:37001;;');
    expect(result).not.toBeNull();
    expect(result!.deviceName).toBe('SM-G998B');
    expect(result!.pairingCode).toBe('123456');
    expect(result!.host).toBe('192.168.1.100');
    expect(result!.pairingPort).toBe(37001);
  });

  it('解析另一个有效的 ADB QR 码', () => {
    const result = parseAdbQrCode('WIFI:T:ADB;S:Pixel-7;P:654321;H:192.168.43.1;D:38721;;');
    expect(result).not.toBeNull();
    expect(result!.deviceName).toBe('Pixel-7');
    expect(result!.pairingCode).toBe('654321');
    expect(result!.host).toBe('192.168.43.1');
    expect(result!.pairingPort).toBe(38721);
  });

  it('非 ADB 前缀返回 null', () => {
    expect(parseAdbQrCode('WIFI:T:WPA;S:MyWiFi;;')).toBeNull();
  });

  it('缺少必要字段返回 null', () => {
    expect(parseAdbQrCode('WIFI:T:ADB;S:Test;;')).toBeNull();
  });

  it('空字符串返回 null', () => {
    expect(parseAdbQrCode('')).toBeNull();
  });

  it('端口号无效返回 null', () => {
    expect(parseAdbQrCode('WIFI:T:ADB;S:Test;P:123;H:1.2.3.4;D:99999;;')).toBeNull();
  });

  it('字段顺序无关', () => {
    const result = parseAdbQrCode('WIFI:T:ADB;D:37001;H:10.0.0.1;P:111111;S:OnePlus;;');
    expect(result).not.toBeNull();
    expect(result!.deviceName).toBe('OnePlus');
    expect(result!.pairingCode).toBe('111111');
    expect(result!.host).toBe('10.0.0.1');
    expect(result!.pairingPort).toBe(37001);
  });
});

describe('isValidIpAddress', () => {
  it('有效的 IPv4 地址', () => {
    expect(isValidIpAddress('192.168.1.1')).toBe(true);
    expect(isValidIpAddress('10.0.0.1')).toBe(true);
    expect(isValidIpAddress('0.0.0.0')).toBe(true);
    expect(isValidIpAddress('255.255.255.255')).toBe(true);
  });

  it('无效的 IP 地址', () => {
    expect(isValidIpAddress('')).toBe(false);
    expect(isValidIpAddress('not-an-ip')).toBe(false);
    expect(isValidIpAddress('256.1.2.3')).toBe(false);
    expect(isValidIpAddress('1.2.3')).toBe(false);
    expect(isValidIpAddress('1.2.3.4.5')).toBe(false);
    expect(isValidIpAddress('1.2.3.')).toBe(false);
  });
});

describe('isValidPort', () => {
  it('有效的端口号', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(5555)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it('无效的端口号', () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(3.14)).toBe(false);
  });
});