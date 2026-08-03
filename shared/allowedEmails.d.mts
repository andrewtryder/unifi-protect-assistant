export class AllowedEmailsError extends Error {
  code: string;
  constructor(message: string, code?: string);
}

export function parseAllowedEmailsStrict(raw: string | undefined | null): {
  emails: string[];
  duplicatesFound: boolean;
  count: number;
};

export function isEmailInAllowlist(email: string, allowlist: readonly string[]): boolean;

export function parseAllowedEmailsSet(raw: string | undefined | null): Set<string>;
