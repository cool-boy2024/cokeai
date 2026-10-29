export type BrandMark = {
  name: string;
  file: string;
};

// Decorative ecosystem marks used by the home hero orbit. They identify the AI
// products and models the shop works with; they do not imply endorsement.
export const BRAND_MARKS: BrandMark[] = [
  { name: "OpenAI", file: "/brands/openai.svg" },
  { name: "DeepSeek", file: "/brands/deepseek.svg" },
  { name: "Claude", file: "/brands/claude.svg" },
  { name: "Gemini", file: "/brands/gemini.svg" },
  { name: "Grok", file: "/brands/grok.svg" },
  { name: "Muse", file: "/brand/muse-logo.svg" },
  { name: "Qwen", file: "/brands/qwen.svg" },
  { name: "Mistral", file: "/brands/mistral.svg" },
  { name: "Kimi", file: "/brands/kimi.svg" },
  { name: "Ollama", file: "/brands/ollama.svg" },
  { name: "Llama", file: "/brands/meta.svg" },
];

export const MOBILE_MARKS = [
  BRAND_MARKS[0],
  BRAND_MARKS[2],
  BRAND_MARKS[3],
  BRAND_MARKS[1],
  BRAND_MARKS[4],
  BRAND_MARKS.find((mark) => mark.name === "Muse")!,
];
