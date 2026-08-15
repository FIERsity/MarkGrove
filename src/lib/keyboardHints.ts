export type KeyboardHintEnvironment = {
  platform: string;
  userAgent: string;
  maxTouchPoints: number;
  hasFineInput: boolean;
  physicalKeyboardSeen: boolean;
};

export function isLikelyIPad({ platform, userAgent, maxTouchPoints }: Pick<KeyboardHintEnvironment, "platform" | "userAgent" | "maxTouchPoints">): boolean {
  return /iPad/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function quickOpenShortcutHint(environment: KeyboardHintEnvironment): "⌘K" | "Ctrl K" | null {
  const iPad = isLikelyIPad(environment);
  if (iPad) return environment.hasFineInput || environment.physicalKeyboardSeen ? "⌘K" : null;
  if (/Android|iPhone|iPod|Mobile/i.test(environment.userAgent)) return null;
  if (/Mac/.test(environment.platform)) return "⌘K";
  if (/Win|Linux|X11/.test(environment.platform)) return "Ctrl K";
  return null;
}
