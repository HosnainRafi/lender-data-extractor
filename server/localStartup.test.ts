import { afterEach, describe, expect, it } from "vitest";
import { createContext } from "./_core/context";

const originalLocalMode = process.env.LOCAL_MODE;

afterEach(() => {
  if (originalLocalMode === undefined) delete process.env.LOCAL_MODE;
  else process.env.LOCAL_MODE = originalLocalMode;
});

describe("local startup context", () => {
  it("creates a local operator without loading OAuth configuration", async () => {
    process.env.LOCAL_MODE = "true";
    delete process.env.OAUTH_SERVER_URL;

    const context = await createContext({
      req: {} as any,
      res: {} as any,
    });

    expect(context.user).toMatchObject({
      id: 1,
      openId: "local-operator",
      role: "admin",
    });
  });
});
