export interface DeskPilotBrowserConversationInput {
  activeTabId: string;
  url: string;
  title: string;
}

export interface DeskPilotConversationBinding {
  id: string;
  chatGptConversationId: string;
  title: string;
}

function cleanTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ").slice(0, 200);
  return title && title !== "ChatGPT" ? title : "ChatGPT conversation";
}

export function deskPilotConversationFromBrowser(
  input: DeskPilotBrowserConversationInput,
): DeskPilotConversationBinding | undefined {
  if (input.activeTabId !== "home") return undefined;
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return undefined;
  }
  if (url.origin !== "https://chatgpt.com") return undefined;
  const match = /^\/c\/([A-Za-z0-9_-]{6,128})\/?$/.exec(url.pathname);
  if (!match) return undefined;
  const chatGptConversationId = match[1]!;
  return {
    id: "chatgpt:" + chatGptConversationId,
    chatGptConversationId,
    title: cleanTitle(input.title),
  };
}
