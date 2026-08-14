import { del, get, set } from "idb-keyval";
import type { LangMessageItem, LangMessageRole } from "aiwrapper";

export type StoredMessage = {
  role: LangMessageRole;
  items: LangMessageItem[];
  meta?: Record<string, any>;
};

const STORAGE_KEY = "messages";

export async function ensurePersistentStorage(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return;
  }

  try {
    const alreadyPersisted = await navigator.storage.persisted?.();
    if (!alreadyPersisted) {
      await navigator.storage.persist();
    }
  } catch (error) {
    console.warn("Unable to ensure persistent storage", error);
  }
}

export async function saveStoredMessages(messages: StoredMessage[]): Promise<boolean> {
  try {
    await set(STORAGE_KEY, messages);
    return true;
  } catch (error) {
    console.error("Failed to persist messages in IndexedDB", error);
    return false;
  }
}

export async function loadStoredMessages(): Promise<StoredMessage[] | null> {
  try {
    const messages = await get<StoredMessage[] | undefined>(STORAGE_KEY);
    return messages ?? null;
  } catch (error) {
    console.error("Failed to load messages from IndexedDB", error);
    return null;
  }
}

export async function clearStoredMessages(): Promise<void> {
  try {
    await del(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear stored messages from IndexedDB", error);
  }
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }

  try {
    return await navigator.storage.estimate();
  } catch (error) {
    console.warn("Unable to get storage estimate", error);
    return null;
  }
}

