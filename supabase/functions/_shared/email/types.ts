export type SenderProfile = "international" | "rub";

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailSendResult = {
  ok: boolean;
  status: number;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
  providerMessageId?: string;
};
