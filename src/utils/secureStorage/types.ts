export type SecureStorageValue = any;

export interface SecureStorage {
  get(key: string): Promise<SecureStorageValue>;
  set(key: string, value: SecureStorageValue): Promise<void>;
  delete(key: string): Promise<void>;
}
