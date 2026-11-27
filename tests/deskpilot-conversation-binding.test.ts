import { describe, expect, test } from "bun:test";
import { deskPilotConversationFromBrowser } from "../src/deskpilot";

describe("DeskPilot ChatGPT conversation binding", () => {
  test("binds only the home ChatGPT conversation tab and exposes a stable local id", () => {
    expect(deskPilotConversationFromBrowser({
      activeTabId: "home",
      url: "https://chatgpt.com/c/abcDEF_123-xyz",
      title: "  Project   planning  ",
    })).toEqual({
      id: "chatgpt:abcDEF_123-xyz",
      chatGptConversationId: "abcDEF_123-xyz",
      title: "Project planning",
    });
  });

  test("rejects non-home tabs, non-conversation pages, and non-ChatGPT origins", () => {
    const inputs = [
      { activeTabId: "turn-1", url: "https://chatgpt.com/c/abcdef", title: "Turn tab" },
      { activeTabId: "home", url: "https://chatgpt.com/", title: "ChatGPT" },
      { activeTabId: "home", url: "https://chatgpt.com/new", title: "New chat" },
      { activeTabId: "home", url: "https://chatgpt.com/c/short", title: "Short id" },
      { activeTabId: "home", url: "https://example.com/c/abcdef", title: "Wrong origin" },
      { activeTabId: "home", url: "not a URL", title: "Invalid URL" },
    ];
    for (const input of inputs) {
      expect(deskPilotConversationFromBrowser(input)).toBeUndefined();
    }
  });

  test("normalizes generic titles and caps renderer-safe metadata", () => {
    expect(deskPilotConversationFromBrowser({
      activeTabId: "home",
      url: "https://chatgpt.com/c/abcdef",
      title: "  ChatGPT  ",
    })?.title).toBe("ChatGPT conversation");

    const longTitle = "x".repeat(240);
    expect(deskPilotConversationFromBrowser({
      activeTabId: "home",
      url: "https://chatgpt.com/c/abcdef",
      title: longTitle,
    })?.title).toBe("x".repeat(200));
  });
});
