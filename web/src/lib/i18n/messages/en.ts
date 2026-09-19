/**
 * The English dictionary, and the source of truth for which keys exist.
 *
 * `satisfies` rather than a type annotation is deliberate: annotating this as
 * `Record<string, Message>` would widen `keyof typeof en` to `string` and the
 * check that every key has a translation would silently stop working.
 */

/**
 * A message is either plain text or a pair of forms chosen by a count.
 *
 * Only the few English strings that inflect use the pair. Chinese uses one form
 * for every count and stores a plain string under the same key, which the
 * Dictionary type allows.
 */
export type Message = string | { one: string; other: string };

export const en = {
  "app.title": "Purels Admin",
  "app.description": "Purels link management and operations console",

  "nav.overview": "Overview",
  "nav.links": "Link management",
  "nav.stats": "Statistics",
  "nav.audit": "Audit log",
  "nav.users": "User management",
  "nav.roles": "Role permissions",
  "nav.oidc": "Sign-in methods",
  "nav.analytics": "Tracking settings",
  "nav.security": "Security settings",
  "nav.captcha": "Registration protection",

  "shell.console": "Admin console",
  "shell.workspace": "Workspace",
  "shell.welcome": "Welcome back",
  "shell.welcomeNamed": "Welcome back, {username}",
  "shell.logout": "Sign out",
  "shell.loggingOut": "Signing out...",
  "shell.closeMenu": "Close menu",
  "shell.openMenu": "Open menu",
  "shell.language": "Language",

  "login.subtitle": "Short link console",
  "login.heading": "Sign in",
  "login.mfaHeading": "Two-factor authentication",
  "login.username": "Username",
  "login.password": "Password",
  "login.code": "Verification code",
  "login.submit": "Sign in",
  "login.submitting": "Signing in...",
  "login.verify": "Verify",
  "login.verifying": "Verifying...",
  "login.back": "Back",
  "login.or": "or",
  "login.noAccount": "No account?",
  "login.register": "Register",
  "login.failed": "Sign-in failed. Please try again.",
  "login.verifyFailed": "Verification failed. Please try again.",

  // The API redirects a failed external sign-in back with a fixed code rather
  // than a message, so the console owns all of this wording.
  "oidcError.oidc_not_provisioned": "No usable account is linked to this identity. Contact an administrator.",
  "oidcError.oidc_state": "This sign-in has expired. Please start again.",
  "oidcError.oidc_exchange": "The identity provider did not complete the sign-in. Please try again.",
  "oidcError.oidc_unavailable": "This sign-in method is unavailable. Contact an administrator.",
  "oidcError.oidc_failed": "Sign-in failed. Please try again.",

  "register.heading": "Register",
  "register.username": "Username",
  "register.password": "Password",
  "register.submit": "Register",
  "register.submitting": "Registering...",
  "register.haveAccount": "Already have an account?",
  "register.login": "Sign in",
  "register.completeCaptcha": "Complete the verification first.",
  "register.captchaLoadFailed": "Could not load the registration check.",
  "register.failed": "Registration failed. Please try again.",

  "turnstile.loadFailed": "The verification failed to load. Please try again.",

  // Role names are rows in the database, so this is the shipped set rather than
  // a closed one: an unrecognised name renders as the raw value.
  "role.admin": "Administrator",
  "role.operator": "Operator",
  "role.readonly": "Read-only",
  "role.user": "User",

  // The codes the API sends beside its own English message. A code is only here
  // when it fully captures what went wrong; anything else arrives without a code
  // and the console shows the API's message instead of inventing one.
  "error.network": "Cannot reach the API server. Check the backend address.",
  "error.session_expired": "Your session has expired. Please sign in again.",
  "error.http_error": "Request failed ({status}).",
  "error.invalid_request": "The request could not be read.",
  "error.unauthorized": "You are not signed in, or your session has expired.",
  "error.insufficient_scope": "You do not have permission to do that.",
  "error.csrf_required": "The security token is missing. Please reload the page.",
  "error.csrf_invalid": "The security token is invalid. Please reload the page.",
  "error.csrf_unavailable": "Could not obtain a security token. Please reload the page.",
  "error.not_found": "That record does not exist, or has been deleted.",
  "error.conflict": "That record already exists.",
  "error.rate_limited": "Too many requests. Please slow down and try again.",
  "error.internal_error": "Something went wrong. Please try again.",
  "error.database_unavailable": "The database is temporarily unavailable.",
  "error.registration_disabled": "Registration is not open on this deployment.",
  "error.invalid_credentials": "Incorrect username or password.",
  "error.invalid_second_factor": "The verification code is incorrect or has expired.",
  "error.two_factor_unavailable": "Two-factor authentication is not available on this deployment.",
  "error.no_enrolment": "No enrolment is in progress.",
  "error.quota_exceeded": "You have reached your link limit.",
  "error.last_capability_holder": "At least one enabled account must keep this permission.",
  "error.secrets_unavailable": "This deployment cannot store encrypted secrets. Set SECRET_ENCRYPTION_KEY.",
  "error.oidc_slug_immutable": "The identifier cannot be changed after creation. Add a separate method instead.",
  "error.captcha_unavailable": "Registration protection is temporarily unavailable.",
  "error.captcha_invalid": "The verification did not pass. Please try again.",
  "error.captcha_invalid_settings": "The registration protection settings are invalid.",
  "error.captcha_secrets_unavailable": "This deployment cannot store encrypted secrets. Set SECRET_ENCRYPTION_KEY.",
  "error.analytics_invalid": "The tracking settings are invalid.",

  // What a caller falls back to when the error carries neither a code the
  // console knows nor a message worth showing.
  "error.load": "Failed to load.",
  "error.save": "Failed to save.",
  "error.create": "Failed to create.",
  "error.update": "Failed to update.",
  "error.delete": "Failed to delete.",
  "error.revoke": "Failed to revoke.",
  "error.reset": "Failed to reset.",
  "error.operation": "The operation failed.",
} satisfies Record<string, Message>;

/** Every key a dictionary must define. */
export type MessageKey = keyof typeof en;

/** A complete set of translations. Chinese satisfies this with plain strings. */
export type Dictionary = Record<MessageKey, Message>;
