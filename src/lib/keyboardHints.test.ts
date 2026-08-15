import { describe, expect, it } from "vitest";
import { quickOpenShortcutHint } from "./keyboardHints";

describe("quick-open shortcut hints", () => {
  it("uses the platform-native modifier on desktop", () => {
    expect(quickOpenShortcutHint({ platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 0, hasFineInput: true, physicalKeyboardSeen: false })).toBe("⌘K");
    expect(quickOpenShortcutHint({ platform: "Win32", userAgent: "Windows", maxTouchPoints: 0, hasFineInput: true, physicalKeyboardSeen: false })).toBe("Ctrl K");
  });

  it("keeps phone and touch-only iPad layouts free of shortcut hints", () => {
    expect(quickOpenShortcutHint({ platform: "iPhone", userAgent: "iPhone", maxTouchPoints: 5, hasFineInput: false, physicalKeyboardSeen: false })).toBeNull();
    expect(quickOpenShortcutHint({ platform: "Linux armv8l", userAgent: "Android Mobile", maxTouchPoints: 5, hasFineInput: true, physicalKeyboardSeen: true })).toBeNull();
    expect(quickOpenShortcutHint({ platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 5, hasFineInput: false, physicalKeyboardSeen: false })).toBeNull();
  });

  it("shows the iPad hint after external input is available", () => {
    expect(quickOpenShortcutHint({ platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 5, hasFineInput: true, physicalKeyboardSeen: false })).toBe("⌘K");
    expect(quickOpenShortcutHint({ platform: "iPad", userAgent: "iPad", maxTouchPoints: 5, hasFineInput: false, physicalKeyboardSeen: true })).toBe("⌘K");
  });
});
