import type { Article, PublishJob } from "@workspace/db";

export type PublishContext = {
  article: Article;
  job: PublishJob;
};

export type PublishResult = {
  publishedUrl: string;
};

export type Publisher = (context: PublishContext) => Promise<PublishResult>;