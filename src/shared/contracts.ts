import { z } from "zod";

export type ConnectionInfo = {
  token: string;
  path: string;
  localUrl: string;
  publicUrl: string | null;
  chatgptUrl: string | null;
  webUrl: string | null;
  prompt: string | null;
  claudeDesktopConfig: string | null;
  tunnel: {
    status:
      | "disabled"
      | "starting"
      | "installing"
      | "ready"
      | "reconnecting"
      | "error";
    publicUrl: string | null;
    chatgptUrl: string | null;
    webUrl: string | null;
    error: string | null;
  };
};

export const workspacePreferencesSchema = z
  .object({
    premiumPurchased: z.boolean(),
  })
  .strict();
export type WorkspacePreferences = z.infer<typeof workspacePreferencesSchema>;

export const credentialsSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(1024),
  })
  .strict();
export const permitSchema = z.enum([
  "B",
  "A2-A1",
  "AM",
  "C",
  "D",
  "BE",
  "CE-DE",
  "CAP",
  "ADR",
  "puntos",
]);
export const languageSchema = z.enum(["en", "es"]);
export const sectionIdSchema = z.string().regex(/^\d{1,8}$/);
export const startSchema = z
  .object({
    url: z.url().max(2048).optional(),
    sectionId: sectionIdSchema.optional(),
    permit: permitSchema.default("B"),
    language: languageSchema.default("en"),
  })
  .strict()
  .refine((value) => Boolean(value.url) !== Boolean(value.sectionId), {
    message: "Provide exactly one of url or sectionId.",
  });
export const answerSchema = z
  .object({
    questionId: z.string().min(1).max(80),
    optionIds: z.array(z.string().min(1).max(8)).min(1).max(10),
  })
  .strict();
export type Permit = z.infer<typeof permitSchema>;
export type Option = { id: string; text: string };
export type Question = {
  id: string;
  number: number;
  text: string;
  imageUrl: string | null;
  options: Option[];
  multiple: boolean;
};
export type Answer = {
  questionId: string;
  optionIds: string[];
  correct: boolean;
  correctOptionIds: string[];
};
export type AnswerFeedback = Answer & {
  progress: { answered: number; total: number; correct: number };
  nextQuestion: Question | null;
};
export type TestView = {
  id: string;
  title: string;
  url: string;
  language: "en" | "es";
  permit: string;
  questions: Question[];
  answers: Answer[];
  createdAt: string;
  submittedAt: string | null;
  syncState: "local" | "sending" | "submitted" | "uncertain";
};
export type TestLink = { title: string; url: string };
export type ManualSection = {
  id: string;
  number: number;
  title: string;
  language: "en" | "es";
  permit: string;
  summaryUrl: string;
  fullUrl: string | null;
  testUrl: string | null;
};
export type SectionRules = {
  section: ManualSection;
  mode: "summary" | "full";
  url: string;
  title: string;
  text: string;
  headings: string[];
  images: { url: string; alt: string }[];
  tables: string[][][];
};
export type AccountAccess = {
  permit: Permit;
  language: "en" | "es";
  checkedAt: string;
  sectionCount: number;
  topicTestCount: number;
  fullRulesCount: number;
  generalTestLinkCount: number | null;
  premiumAccess: "available" | "not_confirmed";
};
export type SessionStatus = {
  authenticated: boolean;
  expiresAt: string | null;
  remembered: boolean;
  credentialsRemembered: boolean;
  lastVerifiedAt: string | null;
  access: AccountAccess[];
};
