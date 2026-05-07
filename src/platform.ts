// Platform detection and filtering. Marshal is Windows-first but the
// schema is platform-agnostic so macOS/Linux can be added later without
// touching the manifest contract.

export type Platform = "win32" | "darwin" | "linux";

export const SUPPORTED_PLATFORMS: readonly Platform[] = ["win32", "darwin", "linux"] as const;

export function detectPlatform(): Platform {
  const p = process.platform;
  if (p === "win32" || p === "darwin" || p === "linux") {
    return p;
  }
  throw new Error(`Unsupported platform: ${p}`);
}

// A row applies to the current platform if `platforms` is missing
// (= "all platforms") OR explicitly includes the current platform.
export function appliesToPlatform(
  rowPlatforms: readonly Platform[] | undefined,
  current: Platform,
): boolean {
  if (!rowPlatforms || rowPlatforms.length === 0) {
    return true;
  }
  return rowPlatforms.includes(current);
}
