package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/purels/purels/internal/cache/redis"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/store/postgres"
)

// aliasAttempts bounds how many generated codes are tried before giving up.
const aliasAttempts = 5

// maxBulkIDs bounds one batch, so a single request cannot hold a transaction
// open over the whole table.
const maxBulkIDs = 500

// maxRulesPerLink bounds how many divert rules one link may carry, and
// maxRuleValueLength matches the match_value column width.
const (
	maxRulesPerLink    = 10
	maxRuleValueLength = 255
)

// Rule match types.
const (
	MatchUAContains = "ua_contains"
	MatchDevice     = "device"
)

// Bulk action names. Kept as constants so the service, the handler and the
// front-end agree on the vocabulary.
const (
	BulkDelete    = "delete"
	BulkDisable   = "disable"
	BulkEnable    = "enable"
	BulkTag       = "tag"
	BulkUntag     = "untag"
	BulkSetExpiry = "set_expiry"
)

// ErrQuotaExceeded is returned when an account has reached MaxLinksPerUser. It
// is distinct so the handler can answer 429 rather than a generic 400.
var ErrQuotaExceeded = errors.New("link quota reached")

type LinkService struct {
	Store *postgres.Store
	Cache *redis.Cache
	// SequentialAliases switches generated codes from random strings to Base36
	// values from the alias sequence.
	SequentialAliases bool
	// UniqueURLs makes Create reuse the existing link for a destination rather
	// than minting a second short code for the same page.
	UniqueURLs bool
	// MaxLinksPerUser caps how many live links one regular account may own.
	// Zero disables the cap; administrators are always exempt.
	MaxLinksPerUser int
	// Denylist holds host names that may not be shortened, subdomains included.
	Denylist []string
	// PublicURL is the deployment's own address. It supplies both the default
	// short domain and the scheme every short domain is rendered under.
	PublicURL string
	// ShortDomains are the extra hosts a link may be filed under. A link that
	// names none of them stores the default, which is what an empty value means.
	ShortDomains []string
	// Hasher turns a visitor's address into the digest stored on the click.
	// Its zero value is the default mode, so an unconfigured service still
	// records one.
	Hasher security.IPHasher
}

// CreateResult reports whether Create minted a new short code or handed back an
// existing one under UNIQUE_URLS. The handler turns that into 201 vs 200.
type CreateResult struct {
	Link    domain.Link
	Created bool
}

func (l *LinkService) Create(ctx context.Context, req domain.CreateLinkRequest) (CreateResult, error) {
	if err := security.ValidateDestination(req.DestinationURL); err != nil {
		return CreateResult{}, err
	}
	if security.HostDenied(req.DestinationURL, l.Denylist) {
		return CreateResult{}, errors.New("that destination is not allowed")
	}
	title, err := security.NormalizeTitle(req.Title)
	if err != nil {
		return CreateResult{}, err
	}
	tags, err := security.NormalizeTags(req.Tags)
	if err != nil {
		return CreateResult{}, err
	}
	rules, err := normalizeRules(req.Rules, l.Denylist)
	if err != nil {
		return CreateResult{}, err
	}
	shortDomain, err := l.normalizeDomain(req.Domain)
	if err != nil {
		return CreateResult{}, err
	}
	code := req.RedirectCode
	if code == 0 {
		code = 302
	}
	if code != 301 && code != 302 {
		return CreateResult{}, errors.New("redirect_code must be 301 or 302")
	}
	// Every route that reaches here is authenticated, so the actor is present.
	// A nil owner (no actor) would leave the link owned by nobody, which is the
	// pre-ownership state and is visible to administrators only.
	actorID, hasActor := domain.ActorIDFromContext(ctx)
	var owner *string
	if hasActor {
		owner = &actorID
	}
	if req.Alias != "" {
		alias, err := security.NormalizeAlias(req.Alias)
		if err != nil {
			return CreateResult{}, err
		}
		// Naming an alias always mints a link, so the cap applies before the
		// dedup lookup rather than after it.
		if err := l.checkQuota(ctx); err != nil {
			return CreateResult{}, err
		}
		link := newLink(alias, req.DestinationURL, title, tags, code, req.ExpiresAt)
		link.Rules = rules
		link.Domain = shortDomain
		if err := l.Store.CreateLink(ctx, link, owner); err != nil {
			return CreateResult{}, err
		}
		l.cache(ctx, link)
		return CreateResult{Link: link, Created: true}, nil
	}
	// UNIQUE_URLS reuses the existing short code for this destination. It only
	// applies to generated codes: naming an alias is an explicit instruction, so
	// a caller can still deliberately create a second link to the same page.
	// The lookup matches the actor exactly, so one account is never handed a
	// link that belongs to another.
	if l.UniqueURLs && hasActor {
		existing, err := l.Store.FindLiveLinkByDestination(ctx, req.DestinationURL, actorID)
		if err == nil {
			return CreateResult{Link: existing}, nil
		}
		if !errors.Is(err, postgres.ErrNotFound) {
			return CreateResult{}, err
		}
	}
	// Handing back an existing link costs nothing, so the cap is only checked
	// once it is clear a new row is about to be written.
	if err := l.checkQuota(ctx); err != nil {
		return CreateResult{}, err
	}
	// Generate a code and retry when it is already taken.
	for attempt := 0; attempt < aliasAttempts; attempt++ {
		alias, err := l.nextAlias(ctx)
		if err != nil {
			return CreateResult{}, err
		}
		if security.AliasReserved(alias) {
			continue
		}
		candidate := newLink(alias, req.DestinationURL, title, tags, code, req.ExpiresAt)
		candidate.Rules = rules
		candidate.Domain = shortDomain
		if err := l.Store.CreateLink(ctx, candidate, owner); err == nil {
			l.cache(ctx, candidate)
			return CreateResult{Link: candidate, Created: true}, nil
		} else if !errors.Is(err, postgres.ErrConflict) {
			return CreateResult{}, err
		}
	}
	return CreateResult{}, postgres.ErrConflict
}

// checkQuota enforces the per-account cap. The count and the insert are not one
// transaction, so a burst of concurrent creates can overshoot by a few: the cap
// is an abuse guard, not an accounting invariant.
func (l *LinkService) checkQuota(ctx context.Context) error {
	if l.MaxLinksPerUser <= 0 {
		return nil
	}
	user, ok := domain.UserFromContext(ctx)
	if !ok || user.ID == "" || user.Unrestricted {
		return nil
	}
	total, err := l.Store.CountLinksByOwner(ctx, user.ID)
	if err != nil {
		return err
	}
	if total >= int64(l.MaxLinksPerUser) {
		return ErrQuotaExceeded
	}
	return nil
}

// Expand resolves a short code back to its link. Codes are case-insensitive, so
// the lookup folds the case the same way creation did.
func (l *LinkService) Expand(ctx context.Context, alias string) (domain.Link, error) {
	return l.Store.GetLinkByAlias(ctx, strings.ToLower(alias))
}

// nextAlias produces the next short code: a random string, or the next value of
// the alias sequence rendered in Base36 when sequential mode is on.
func (l *LinkService) nextAlias(ctx context.Context) (string, error) {
	if !l.SequentialAliases {
		return security.RandomString(8)
	}
	value, err := l.Store.NextAliasValue(ctx)
	if err != nil {
		return "", err
	}
	return security.EncodeBase36(value), nil
}

func newLink(alias, destination, title string, tags []string, code int16, expires string) domain.Link {
	var expiresAt *time.Time
	if expires != "" {
		if parsed, err := time.Parse(time.RFC3339, expires); err == nil {
			parsed = parsed.UTC()
			expiresAt = &parsed
		}
	}
	if tags == nil {
		tags = []string{}
	}
	now := time.Now().UTC()
	return domain.Link{ID: postgres.NewID(), Alias: alias, DestinationURL: destination, Title: title, Tags: tags, RedirectCode: code, Status: "active", Version: 1, ExpiresAt: expiresAt, CreatedAt: now, UpdatedAt: now}
}

func (l *LinkService) Resolve(ctx context.Context, alias string) (domain.Link, error) {
	// Folding here keeps the cache key and the stored alias in step: a request
	// for /AbCdE and one for /abcde must share a cache entry.
	alias = strings.ToLower(alias)
	if cached, err := l.Cache.GetLink(ctx, alias); err == nil {
		if isUsable(cached) {
			return *cached, nil
		}
		return domain.Link{}, postgres.ErrNotFound
	}
	link, err := l.Store.GetLinkByAlias(ctx, alias)
	if err != nil {
		return link, err
	}
	if !isUsable(&link) {
		return domain.Link{}, postgres.ErrNotFound
	}
	l.cache(ctx, link)
	return link, nil
}

func isUsable(link *domain.Link) bool {
	if link.Status != "active" {
		return false
	}
	return link.ExpiresAt == nil || link.ExpiresAt.After(time.Now().UTC())
}

func (l *LinkService) Get(ctx context.Context, id string) (domain.Link, error) {
	return l.Store.GetLink(ctx, id, domain.OwnerIDFromContext(ctx))
}
func (l *LinkService) List(ctx context.Context, filter domain.ListFilter) (domain.LinkPage, error) {
	// The visibility scope comes from the session, never from the query string.
	filter.OwnerID = domain.OwnerIDFromContext(ctx)
	links, total, err := l.Store.ListLinks(ctx, filter)
	if err != nil {
		return domain.LinkPage{}, err
	}
	return domain.LinkPage{Links: links, Total: total, Limit: filter.Limit, Offset: filter.Offset}, nil
}

func (l *LinkService) Update(ctx context.Context, id string, req domain.UpdateLinkRequest) (domain.Link, error) {
	owner := domain.OwnerIDFromContext(ctx)
	link, err := l.Store.GetLink(ctx, id, owner)
	if err != nil {
		return link, err
	}
	if req.DestinationURL != "" {
		if err := security.ValidateDestination(req.DestinationURL); err != nil {
			return link, err
		}
		// The denylist is checked here too: otherwise a link could be created on
		// an allowed host and then pointed at a denied one.
		if security.HostDenied(req.DestinationURL, l.Denylist) {
			return link, errors.New("that destination is not allowed")
		}
		link.DestinationURL = req.DestinationURL
	}
	if req.RedirectCode != 0 {
		if req.RedirectCode != 301 && req.RedirectCode != 302 {
			return link, errors.New("redirect_code must be 301 or 302")
		}
		link.RedirectCode = req.RedirectCode
	}
	if req.Status != "" && req.Status != "active" && req.Status != "disabled" {
		return link, errors.New("invalid status")
	} else if req.Status != "" {
		link.Status = req.Status
	}
	if req.ExpiresAt != nil {
		expiresAt, expiresErr := parseExpiry(*req.ExpiresAt)
		if expiresErr != nil {
			return link, expiresErr
		}
		link.ExpiresAt = expiresAt
	}
	if req.Title != nil {
		title, titleErr := security.NormalizeTitle(*req.Title)
		if titleErr != nil {
			return link, titleErr
		}
		link.Title = title
	}
	var tags *[]string
	if req.Tags != nil {
		normalized, tagErr := security.NormalizeTags(*req.Tags)
		if tagErr != nil {
			return link, tagErr
		}
		tags = &normalized
	}
	var rules *[]domain.LinkRule
	if req.Rules != nil {
		normalized, ruleErr := normalizeRules(*req.Rules, l.Denylist)
		if ruleErr != nil {
			return link, ruleErr
		}
		rules = &normalized
	}
	// The loaded link already carries its current domain, so an update that does
	// not mention one leaves it where it is.
	if req.Domain != nil {
		shortDomain, domainErr := l.normalizeDomain(*req.Domain)
		if domainErr != nil {
			return link, domainErr
		}
		link.Domain = shortDomain
	}
	if err := l.Store.UpdateLink(ctx, link, tags, rules, owner); err != nil {
		return link, err
	}
	updated, err := l.Store.GetLink(ctx, id, owner)
	if err == nil {
		l.cache(ctx, updated)
	}
	return updated, err
}

// ListTags returns the tag vocabulary for filter controls.
func (l *LinkService) ListTags(ctx context.Context) ([]domain.TagStat, error) {
	return l.Store.ListTags(ctx, domain.OwnerIDFromContext(ctx))
}

func (l *LinkService) Delete(ctx context.Context, id string) error {
	owner := domain.OwnerIDFromContext(ctx)
	link, err := l.Store.GetLink(ctx, id, owner)
	if err != nil {
		return err
	}
	if err := l.Store.DeleteLink(ctx, id, owner); err != nil {
		return err
	}
	_ = l.Cache.DeleteLink(ctx, link.Alias)
	return nil
}

// Bulk applies one edit to many links at once and reports how many changed.
//
// Every id is filtered through the caller's ownership scope in SQL, so an id
// belonging to somebody else is skipped rather than reported: the count means
// "how many of mine changed", and asking for a foreign id is indistinguishable
// from asking for one that does not exist.
func (l *LinkService) Bulk(ctx context.Context, req domain.BulkLinkRequest) (int64, error) {
	ids, err := normalizeIDs(req.IDs)
	if err != nil {
		return 0, err
	}
	owner := domain.OwnerIDFromContext(ctx)

	var aliases []string
	switch req.Action {
	case BulkDelete:
		aliases, err = l.Store.BulkDeleteLinks(ctx, ids, owner)
	case BulkDisable:
		aliases, err = l.Store.BulkSetStatus(ctx, ids, owner, "disabled")
	case BulkEnable:
		aliases, err = l.Store.BulkSetStatus(ctx, ids, owner, "active")
	case BulkSetExpiry:
		if req.ExpiresAt == nil {
			return 0, errors.New("expires_at is required")
		}
		var expiresAt *time.Time
		expiresAt, err = parseExpiry(*req.ExpiresAt)
		if err == nil {
			aliases, err = l.Store.BulkSetExpiry(ctx, ids, owner, expiresAt)
		}
	case BulkTag, BulkUntag:
		tags, tagErr := security.NormalizeTags(req.Tags)
		if tagErr != nil {
			return 0, tagErr
		}
		if len(tags) == 0 {
			return 0, errors.New("at least one tag is required")
		}
		return l.Store.BulkTagLinks(ctx, ids, owner, tags, req.Action == BulkTag)
	default:
		return 0, errors.New("unknown action")
	}
	if err != nil {
		return 0, err
	}
	// Only the edits that change what a short code resolves to need the cache
	// dropped; tag changes are handled by the store.
	l.evict(ctx, aliases)
	return int64(len(aliases)), nil
}

// evict drops the redirect cache entries for the given aliases.
func (l *LinkService) evict(ctx context.Context, aliases []string) {
	for _, alias := range aliases {
		_ = l.Cache.DeleteLink(ctx, alias)
	}
}

// normalizeIDs validates a bulk id list: present, capped, de-duplicated and
// made of UUIDs, so a malformed entry is a clear 400 rather than a database
// cast error.
func normalizeIDs(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, errors.New("ids is required")
	}
	if len(raw) > maxBulkIDs {
		return nil, fmt.Errorf("at most %d ids per request", maxBulkIDs)
	}
	seen := make(map[string]struct{}, len(raw))
	ids := make([]string, 0, len(raw))
	for _, candidate := range raw {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}
		if _, duplicate := seen[trimmed]; duplicate {
			continue
		}
		if _, err := uuid.Parse(trimmed); err != nil {
			return nil, errors.New("ids must be uuids")
		}
		seen[trimmed] = struct{}{}
		ids = append(ids, trimmed)
	}
	if len(ids) == 0 {
		return nil, errors.New("ids is required")
	}
	return ids, nil
}

// MatchRule picks the first rule that fires for this user agent, in the order
// the store returned them (position, then creation). A rule with no redirect
// code of its own inherits the link's.
//
// It is a pure function so the matching can be tested without a database, and
// so the redirect path stays one pass over a short slice.
func MatchRule(link domain.Link, userAgent string) (string, int16, bool) {
	for _, rule := range link.Rules {
		if !ruleMatches(rule, userAgent) {
			continue
		}
		code := rule.RedirectCode
		if code == 0 {
			code = link.RedirectCode
		}
		return rule.DestinationURL, code, true
	}
	return "", 0, false
}

func ruleMatches(rule domain.LinkRule, userAgent string) bool {
	switch rule.MatchType {
	case MatchUAContains:
		// The comparison is case-insensitive on both sides, so the value is
		// stored as the operator typed it and still matches any casing.
		return strings.Contains(strings.ToLower(userAgent), strings.ToLower(rule.MatchValue))
	case MatchDevice:
		return security.DeviceClass(userAgent) == rule.MatchValue
	default:
		// Only a row written outside the application can land here. It never
		// matches, so a corrupt rule cannot divert traffic on its own.
		return false
	}
}

// normalizeRules validates submitted rules and turns them into their stored
// form. Position comes from the slice index, so list order is match order and a
// caller cannot reorder rules by sending positions of its own.
//
// Every destination goes through the same checks as the link's own, including
// the denylist: without that, a rule would be a way to reach exactly the hosts
// the denylist exists to block.
func normalizeRules(rules []domain.LinkRuleInput, denylist []string) ([]domain.LinkRule, error) {
	if len(rules) > maxRulesPerLink {
		return nil, fmt.Errorf("a link may have at most %d rules", maxRulesPerLink)
	}
	out := make([]domain.LinkRule, 0, len(rules))
	for index, rule := range rules {
		matchType := strings.TrimSpace(rule.MatchType)
		if matchType != MatchUAContains && matchType != MatchDevice {
			return nil, errors.New("match_type must be ua_contains or device")
		}
		matchValue := strings.TrimSpace(rule.MatchValue)
		if matchValue == "" {
			return nil, errors.New("match_value is required")
		}
		if len([]rune(matchValue)) > maxRuleValueLength {
			return nil, fmt.Errorf("match_value must be at most %d characters", maxRuleValueLength)
		}
		if matchType == MatchDevice {
			// Folded here because the stored value is compared for equality at
			// match time, where "Mobile" would never equal what DeviceClass
			// returns.
			matchValue = strings.ToLower(matchValue)
			if !security.IsDeviceClass(matchValue) {
				return nil, errors.New("match_value must be one of unknown, bot, tablet, mobile or desktop")
			}
		}
		if err := security.ValidateDestination(rule.DestinationURL); err != nil {
			return nil, err
		}
		if security.HostDenied(rule.DestinationURL, denylist) {
			return nil, errors.New("that destination is not allowed")
		}
		if code := rule.RedirectCode; code != 0 && code != 301 && code != 302 {
			return nil, errors.New("redirect_code must be 301 or 302")
		}
		out = append(out, domain.LinkRule{
			Position:       index,
			MatchType:      matchType,
			MatchValue:     matchValue,
			DestinationURL: rule.DestinationURL,
			RedirectCode:   rule.RedirectCode,
		})
	}
	return out, nil
}

// parseExpiry reads an RFC3339 instant, where an empty string means "no expiry".
func parseExpiry(raw string) (*time.Time, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, errors.New("expires_at must be RFC3339")
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func (l *LinkService) RecordClick(ctx context.Context, link domain.Link, requestIP, userAgent, referrer string) {
	_ = l.Store.CreateClickEvent(ctx, link.ID, l.Hasher.Hash(requestIP), userAgent, referrer, security.IsBotUA(userAgent))
}

// ShortURL is the public address of a link, on the domain it is filed under.
// The scheme and, for a link on the default domain, the host come from
// PublicURL; an extra short domain replaces the whole authority, so no port
// leaks from PUBLIC_URL into a host that does not serve it.
//
// The domain is display only: a short code resolves on every configured host,
// so this decides what the console shows and what the QR code encodes.
func (l *LinkService) ShortURL(link domain.Link) string {
	base := strings.TrimRight(l.PublicURL, "/")
	if link.Domain != "" {
		if parsed, err := url.Parse(base); err == nil && parsed.Host != "" {
			parsed.Host = link.Domain
			base = strings.TrimRight(parsed.String(), "/")
		}
	}
	return base + "/" + url.PathEscape(link.Alias)
}

// normalizeDomain checks a requested short domain against the configured list.
// An empty value means the default domain, which is what a NULL column means
// too. The list is the only thing between a caller and a short_url pointing at
// a host they do not control, so an unlisted value is refused rather than
// quietly replaced by the default.
func (l *LinkService) normalizeDomain(raw string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return "", nil
	}
	// The column stores a bare host name. A scheme, port or path here would be
	// stored as typed and then never match the picker's own output.
	if strings.ContainsAny(value, "/:@ ") {
		return "", errors.New("domain must be a bare host name")
	}
	for _, allowed := range l.ShortDomains {
		if value == allowed {
			return value, nil
		}
	}
	return "", errors.New("domain is not one of the configured short domains")
}
func (l *LinkService) cache(ctx context.Context, link domain.Link) { _ = l.Cache.SetLink(ctx, link) }
