import { describe, it, expect } from "vitest";
import { intentEngine } from "@/brain/intent/intentEngine";

describe("intentEngine — shopping (Sprint-030)", () => {
  it("routes 'Compare the Nike Crew Neck and the Uniqlo U Crew' to shopping/compare_shopping_options", () => {
    const result = intentEngine.detectIntent("Compare the Nike Crew Neck and the Uniqlo U Crew");
    expect(result.module).toBe("shopping");
    expect(result.intent).toBe("compare_shopping_options");
  });

  it("routes each of the four shopping trigger patterns to shopping/compare_shopping_options", () => {
    const inputs = [
      "compare these two laptops",
      "help me choose between the iPhone and the Pixel",
      "which one should i buy",
      "shopping for a new couch",
    ];
    for (const input of inputs) {
      const result = intentEngine.detectIntent(input);
      expect(result.module).toBe("shopping");
      expect(result.intent).toBe("compare_shopping_options");
    }
  });

  it("doesn't false-positive against the other three module rules' own trigger phrases", () => {
    const otherModulePhrases: Array<{ input: string; module: string }> = [
      { input: "remind me to buy milk", module: "task" },
      { input: "remember that I like pizza", module: "memory" },
      { input: "i am a night owl", module: "memory" },
      { input: "write down my grocery list", module: "document" },
      { input: "draft a memo about the meeting", module: "document" },
      { input: "what time is it", module: "conversation" },
    ];
    for (const { input, module } of otherModulePhrases) {
      const result = intentEngine.detectIntent(input);
      expect(result.module).toBe(module);
      expect(result.module).not.toBe("shopping");
    }
  });
});
