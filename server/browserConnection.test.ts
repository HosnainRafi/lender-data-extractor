import { afterEach, describe, expect, it } from "vitest";

const endpoint = process.env.BROWSER_WS_ENDPOINT;

describe("browser engine connection", () => {
  const sockets: WebSocket[] = [];

  afterEach(() => {
    sockets.forEach(socket => socket.close());
  });

  it.skipIf(!endpoint)("opens and closes the configured browser WebSocket endpoint", async () => {
    const socket = new WebSocket(endpoint!);
    sockets.push(socket);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Browser endpoint did not complete its WebSocket handshake within 10 seconds.")), 10_000);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Browser endpoint rejected the configured WebSocket connection."));
      }, { once: true });
    });

    expect(socket.readyState).toBe(WebSocket.OPEN);
  });
});
