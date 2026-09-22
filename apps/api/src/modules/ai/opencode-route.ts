const ANTHROPIC_WIRE = /^(minimax-|qwen)/i;

export function opencodeSessionId(profileId: string): string {
  return `xtrader-${profileId}`.replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 128);
}

export function isOpencodeFamily(providerId: string): boolean {
  return providerId === "opencode" || providerId === "opencode-zen";
}

/** MiniMax/Qwen on OpenCode Go speak Anthropic `/messages`, not chat completions. */
export function usesOpencodeAnthropicWire(providerId: string, modelId: string): boolean {
  return providerId === "opencode" && ANTHROPIC_WIRE.test(modelId);
}

export function opencodeHeaders(profileId: string): Record<string, string> {
  return {
    "x-opencode-session": opencodeSessionId(profileId),
    "User-Agent": "xTrader/1.0",
  };
}
