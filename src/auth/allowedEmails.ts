/**
 * Worker TypeScript surface for the shared ALLOWED_EMAILS parser.
 */
export {
  AllowedEmailsError,
  parseAllowedEmailsStrict,
  isEmailInAllowlist,
  parseAllowedEmailsSet,
} from "../../shared/allowedEmails.mjs";
