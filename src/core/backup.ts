import { invoke } from "@tauri-apps/api/core";

function collectAppData(): Record<string, string> {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) data[key] = localStorage.getItem(key) ?? "";
  }
  return data;
}

function applyAppData(data: Record<string, string>): void {
  localStorage.clear();
  for (const [key, value] of Object.entries(data)) {
    localStorage.setItem(key, value);
  }
}

export async function exportAppData(): Promise<void> {
  const json = JSON.stringify(collectAppData(), null, 2);
  await invoke("export_app_data", { json });
}

export async function importAppData(): Promise<void> {
  const json = await invoke<string>("import_app_data");
  const data: Record<string, string> = JSON.parse(json);
  applyAppData(data);
  location.reload();
}

export async function autoBackupAppData(): Promise<void> {
  try {
    const json = JSON.stringify(collectAppData());
    await invoke("auto_backup_app_data", { json });
  } catch (e) {
    console.warn("[moku] auto-backup failed:", e);
  }
}