import stripJsonComments from "strip-json-comments";

export function parseJsonc(content: string) {
  const cleaned = stripJsonComments(content);
  return JSON.parse(cleaned);
}