export type SecureStorageData = {
  trustedDeviceToken?: string;
  pluginSecrets?: Record<string, any>;
  [key: string]: any;
};

export interface SecureStorage {
  name: string;
  read(): SecureStorageData | null;
  readAsync(): Promise<SecureStorageData | null>;
  update(data: SecureStorageData): { success: boolean; warning?: string };
  delete(): boolean;
}
