export type ComfyWorkflow = Record<
  string,
  { inputs?: Record<string, unknown>; class_type?: string }
>;

export interface QueuePromptResponse {
  prompt_id: string;
  node_errors?: Record<string, unknown>;
}

export interface OutputImageRef {
  filename: string;
  subfolder: string;
  type: string;
}
