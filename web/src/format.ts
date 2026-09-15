import type { ActionCategory } from "./types";

export function toolTitle(fullName: string): string {
  const name = fullName.replace(/^mcp__gmail__/, "").replace(/^GMAIL_/, "");
  const [resource, operation] = name.split(".");
  if (resource && operation) {
    const words = `${operation} ${resource}`.replace(/[_-]/g, " ");
    return words[0].toUpperCase() + words.slice(1);
  }
  return name
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function categoryLabel(category: ActionCategory): string {
  return {
    read: "Read",
    write: "Change",
    delete: "Delete",
    other: "Tool",
  }[category];
}

export function prettyValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2);
}

export function parseStoredValue(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function shortInput(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const input = value as Record<string, unknown>;
  for (const key of ["subject", "query", "to", "messageId", "name"]) {
    const found = input[key];
    if (typeof found === "string" && found.trim()) return found.length > 74 ? `${found.slice(0, 73)}…` : found;
  }
  return "";
}

export function displayTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function displayDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
