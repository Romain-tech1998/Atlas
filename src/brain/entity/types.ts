/** Structured data pulled out of the raw request text. */
export interface EntityResult {
  title: string;
  dueDate?: string;
  keywords: string[];
}
