/** The agent's normal MCP configuration seam. Firedrill supplies this endpoint in tests. */
export interface GmailMcpEndpoint {
  url: string;
  headers: Record<string, string>;
}

export interface GmailConnectionStatus {
  connected: boolean;
  summary: string;
  connectedAccountId: string | null;
}

export class GmailMcpConnection {
  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
  ) {}

  async mcpEndpoint(): Promise<GmailMcpEndpoint> {
    return {
      url: this.url,
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    };
  }

  async status(): Promise<GmailConnectionStatus> {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "gmail-agent-example", version: "1" },
          },
        }),
      });
      return {
        connected: response.ok,
        connectedAccountId: null,
        summary: response.ok ? "Gmail MCP connected" : `Gmail MCP unavailable (HTTP ${response.status})`,
      };
    } catch {
      return { connected: false, connectedAccountId: null, summary: "Gmail MCP unavailable" };
    }
  }
}
