package domain

// Machine-readable error codes.
//
// These are part of the API's contract in the same way the scope names are: the
// console renders its own localized text for a code, so renaming one silently
// un-translates a message until the web dictionary is updated to match.
//
// A code is only worth adding when it fully captures what went wrong. A
// validation message that names a field or a rule carries more than any code
// could, so those responses deliberately carry no code at all and the console
// shows the message exactly as the API wrote it.
const (
	// CodeInvalidRequest is a body that could not be decoded. Its message is
	// always the generic "invalid request", so the code loses nothing.
	CodeInvalidRequest = "invalid_request"

	CodeUnauthorized      = "unauthorized"
	CodeInsufficientScope = "insufficient_scope"
	CodeCSRFRequired      = "csrf_required"
	CodeCSRFInvalid       = "csrf_invalid"
	CodeCSRFUnavailable   = "csrf_unavailable"

	CodeNotFound             = "not_found"
	CodeConflict             = "conflict"
	CodeRateLimited          = "rate_limited"
	CodeInternalError        = "internal_error"
	CodeDatabaseUnavailable  = "database_unavailable"
	CodeRegistrationDisabled = "registration_disabled"

	CodeInvalidCredentials   = "invalid_credentials"
	CodeInvalidSecondFactor  = "invalid_second_factor"
	CodeTwoFactorUnavailable = "two_factor_unavailable"
	CodeNoEnrolment          = "no_enrolment"

	CodeQuotaExceeded        = "quota_exceeded"
	CodeLastCapabilityHolder = "last_capability_holder"
	CodeSecretsUnavailable   = "secrets_unavailable"
	CodeOIDCSlugImmutable    = "oidc_slug_immutable"

	CodeCaptchaUnavailable        = "captcha_unavailable"
	CodeCaptchaInvalid            = "captcha_invalid"
	CodeCaptchaInvalidSettings    = "captcha_invalid_settings"
	CodeCaptchaSecretsUnavailable = "captcha_secrets_unavailable"

	CodeAnalyticsInvalid = "analytics_invalid"
)
