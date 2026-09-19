package handler

import "testing"

func TestPreferredLang(t *testing.T) {
	cases := []struct {
		name           string
		acceptLanguage string
		want           string
	}{
		{"no header falls back", "", langEnglish},
		{"an exact tag", "zh-CN", langChinese},
		{"a bare primary subtag", "zh", langChinese},
		{"a regional subtag", "zh-Hans-CN", langChinese},
		{"a script variant", "zh-TW", langChinese},
		{"a tag is case insensitive", "ZH-cn", langChinese},
		{"english", "en-US,en;q=0.9", langEnglish},
		{"a browser's usual Chinese list", "zh-CN,zh;q=0.9,en;q=0.8", langChinese},
		{"a browser's usual English list", "en-US,en;q=0.9,zh-CN;q=0.8", langEnglish},
		// The order a client lists tags in is a hint, not a promise: a language it
		// ranks below another must not win just for arriving first.
		{"quality beats order, Chinese first", "zh;q=0.1,en;q=0.9", langEnglish},
		{"quality beats order, English first", "en;q=0.2,zh;q=0.9", langChinese},
		// A q of zero is an explicit refusal, so it must not be chosen even when
		// it is the only tag that names a language we speak.
		{"a refused language is skipped", "en;q=0,zh;q=0.5", langChinese},
		{"a refused language alone falls back", "en;q=0", langEnglish},
		{"an unsupported language falls back", "fr-FR,de;q=0.8", langEnglish},
		{"a wildcard falls back", "*", langEnglish},
		{"an unparsable quality falls back", "zh;q=abc", langEnglish},
		{"an empty entry is skipped", ",,zh", langChinese},
		{"whitespace is tolerated", "  zh-CN , en;q=0.5 ", langChinese},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := preferredLang(c.acceptLanguage); got != c.want {
				t.Fatalf("preferredLang(%q) = %q, want %q", c.acceptLanguage, got, c.want)
			}
		})
	}
}

func TestPreviewContinueLabel(t *testing.T) {
	if got := previewContinueLabel(langChinese); got != "继续" {
		t.Fatalf("the Chinese label = %q", got)
	}
	if got := previewContinueLabel(langEnglish); got != "Continue" {
		t.Fatalf("the English label = %q", got)
	}
	// Anything that is not the Chinese constant gets the default, so a language
	// added later cannot end up with an empty button.
	if got := previewContinueLabel("fr"); got != "Continue" {
		t.Fatalf("an unknown language = %q", got)
	}
}
