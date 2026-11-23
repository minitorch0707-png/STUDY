declare module "word-extractor" {
  interface ExtractedDocument {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(opts?: { includeFooters?: boolean }): string;
  }
  export default class WordExtractor {
    extract(input: string | Buffer): Promise<ExtractedDocument>;
  }
}
