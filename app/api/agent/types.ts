export type EasyMessage = {
  role: "system" | "user" | "assistant" | "developer";
  content: string | InputContent[];
};

export type InputContent = InputText | InputImage | InputFile;
export type OutputContent = OutputText | Refusal;
export type Content = InputContent | OutputContent;

export type InputText = {
  type: "input_text";
  text: string;
};

export type OutputText = {
  type: "output_text";
  text: string;
  annotations: Annotation[];
};

export type Refusal = {
  type: "refusal";
  refusal: string;
};

export type InputImage = {
  type: "input_image";
  image_url?: string;
  file_id?: string;
  detail: "high" | "low" | "auto";
};

export type InputFile = {
  type: "input_file";
  file_id: string | null;
  filename: string | null;
  file_data: string | null;
};

// Basic annotation types
export type FileCitation = {
  type: "file_citation";
  index: number;
  file_id: string;
  filename: string;
};

export type FilePath = {
  type: "file_path";
  file_id: string;
  index: number;
};

export type Annotation = FileCitation | FilePath;

// Function outputs
export type FunctionOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type ComputerCallOutput = {
  type: "computer_call_output";
  call_id: string;
  output: { type: "input_image"; image_url: string };
  acknowledged_safety_checks: any[];
  current_url?: string;
};
