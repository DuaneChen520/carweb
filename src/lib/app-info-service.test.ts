import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppInfoService } from './app-info-service';

describe('AppInfoService', () => {
  let service: AppInfoService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AppInfoService();
  });
});
