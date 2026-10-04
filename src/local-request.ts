/** The local example must not accept requests from remote pages or DNS rebinding. */
export function isLocalRequest(host: string | undefined, origin: string | undefined, ports: number[]): boolean {
  if (!host || !ports.some((port) => host === `127.0.0.1:${port}` || host === `localhost:${port}`)) return false;
  if (origin === undefined) return true; // non-browser clients still need a loopback Host
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") && ports.includes(Number(url.port));
  } catch { return false; }
}
