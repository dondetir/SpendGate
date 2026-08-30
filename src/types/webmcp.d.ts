// Minimal ambient types for the WebMCP browser API (document.modelContext).
// Spec: https://webmachinelearning.github.io/webmcp/ ; ChatGPT site-tools use document.modelContext.

export interface ModelContextToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ModelContextTool {
  name: string;
  description: string;
  title?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ModelContextToolAnnotations;
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown> | unknown;
}

export interface ModelContext {
  registerTool(tool: ModelContextTool, options?: unknown): Promise<unknown>;
  getTools?(): Promise<ModelContextTool[]>;
  unregisterTool?(name: string): Promise<unknown> | void;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    // some early blog examples reference navigator.modelContext; probe both to be safe
    modelContext?: ModelContext;
  }
}
