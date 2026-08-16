export interface IssuedDeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly intervalSec: number;
  readonly expiresAt: Date;
}

export type DeviceApprovalResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_found' | 'expired' | 'already_resolved' };

export type DevicePollOutcome =
  | { readonly status: 'authorization_pending' | 'slow_down' | 'expired' | 'denied' }
  | {
      readonly status: 'approved';
      readonly userId: string;
      readonly role: string;
      readonly deviceName: string;
    };

/** Existing API device-code lifecycle binding; cowork/auth clients remain transport consumers. */
export interface LocalDeviceAttachmentPort {
  issueDeviceCode(deviceName?: string | null): IssuedDeviceCode;
  pollDeviceCode(deviceCode: string): DevicePollOutcome;
  approveDeviceCode(
    userCode: string,
    userId: string,
    role: string,
    deviceName?: string | null,
  ): DeviceApprovalResult;
}

export interface DeviceDomain extends LocalDeviceAttachmentPort {}

export function createLocalDeviceDomain(port: LocalDeviceAttachmentPort): DeviceDomain {
  return {
    issueDeviceCode(deviceName) {
      return port.issueDeviceCode(deviceName);
    },
    pollDeviceCode(deviceCode) {
      return port.pollDeviceCode(deviceCode);
    },
    approveDeviceCode(userCode, userId, role, deviceName) {
      return port.approveDeviceCode(userCode, userId, role, deviceName);
    },
  };
}
