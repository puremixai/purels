package handler

import (
	"strconv"
	"strings"
)

// The preview page is the one document the API renders itself, so there is no
// console to localize it. It picks a language from the request's Accept-Language
// header and falls back to English, which is also the console's own default.
const (
	langEnglish = "en"
	langChinese = "zh-CN"

	defaultLang = langEnglish
)

// preferredLang picks the language the client asked for, honouring the quality
// values rather than just the order the tags arrived in: a client is allowed to
// list a language it does not want first, and picking that one would be worse
// than falling back.
func preferredLang(acceptLanguage string) string {
	best, bestQuality := defaultLang, -1.0
	for _, part := range strings.Split(acceptLanguage, ",") {
		tag, quality := parseLanguageTag(part)
		// A quality of zero means "explicitly not this one", and an unparsable
		// quality is treated the same way rather than guessing at it.
		if tag == "" || quality <= 0 {
			continue
		}
		language := matchLanguage(tag)
		if language == "" || quality <= bestQuality {
			continue
		}
		best, bestQuality = language, quality
	}
	return best
}

// parseLanguageTag splits one Accept-Language entry into its tag and its q
// value. Any parameter other than q is ignored, which is what the header allows.
func parseLanguageTag(part string) (string, float64) {
	part = strings.TrimSpace(part)
	if part == "" {
		return "", 0
	}
	tag, params, _ := strings.Cut(part, ";")
	quality := 1.0
	if params != "" {
		for _, param := range strings.Split(params, ";") {
			name, value, found := strings.Cut(strings.TrimSpace(param), "=")
			if !found || !strings.EqualFold(strings.TrimSpace(name), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil {
				return "", 0
			}
			quality = parsed
		}
	}
	return strings.TrimSpace(tag), quality
}

// matchLanguage maps a tag onto one of the two languages the API speaks, by its
// primary subtag: a request for zh-Hans or zh-TW is served the Chinese page, and
// en-GB the English one.
func matchLanguage(tag string) string {
	primary, _, _ := strings.Cut(tag, "-")
	switch strings.ToLower(primary) {
	case "zh":
		return langChinese
	case "en":
		return langEnglish
	}
	return ""
}

// previewContinueLabel is the page's only piece of copy. The interstitial page
// uses it too: both are offering the visitor the same thing, which is to go on
// now rather than wait.
func previewContinueLabel(language string) string {
	if language == langChinese {
		return "继续"
	}
	return "Continue"
}

func pageServiceLabel(language string) string {
	if language == langChinese {
		return "短链接服务"
	}
	return "SHORT LINK SERVICE"
}

func previewEyebrow(language string) string {
	if language == langChinese {
		return "链接预览"
	}
	return "LINK PREVIEW"
}

func interstitialEyebrow(language string) string {
	if language == langChinese {
		return "正在准备跳转"
	}
	return "PREPARING YOUR REDIRECT"
}

func destinationLabel(language string) string {
	if language == langChinese {
		return "目标地址"
	}
	return "DESTINATION"
}

func previewDescription(language string) string {
	if language == langChinese {
		return "请确认目标地址，再继续前往。"
	}
	return "Review the destination before you continue."
}

func interstitialDescription(language string) string {
	if language == langChinese {
		return "即将带你前往下面的地址。"
	}
	return "You are about to leave for the destination below."
}

func externalDestinationLabel(language string) string {
	if language == langChinese {
		return "外部目标地址"
	}
	return "EXTERNAL DESTINATION"
}

func poweredByLabel(language string) string {
	if language == langChinese {
		return "由 Purels 提供"
	}
	return "POWERED BY PURELS"
}

// interstitialWaitLabel says how long the page will hold. seconds is an int16
// the service has already range-checked, so the result carries nothing a caller
// could have supplied.
func interstitialWaitLabel(language string, seconds int16) string {
	if language == langChinese {
		return strconv.Itoa(int(seconds)) + " 秒后自动跳转"
	}
	return "Redirecting in " + strconv.Itoa(int(seconds)) + " seconds"
}
