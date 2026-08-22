import { requestUrl } from "obsidian";

export type HttpRequest = Exclude<Parameters<typeof requestUrl>[0], string>;
export type HttpResponse = Awaited<ReturnType<typeof requestUrl>>;

export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
}

export const obsidianHttpClient: HttpClient = {
  request: (request) => requestUrl(request),
};
