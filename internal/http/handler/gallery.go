package handler

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"math/rand/v2"
	"net/url"
)

// The public page is served by the API, independently of the console. Only the
// chosen SVG is rendered; the other works never travel with the response.
//
//go:embed gallery/*.html gallery/*.css gallery/*.js gallery/*.json gallery/art/*.svg
var galleryFiles embed.FS

type galleryArtwork struct {
	Slug               string
	Title              string
	Artist             string
	Year               string
	Medium             string
	Collection         string
	Description        string
	Alt                string
	EnglishTitle       string
	EnglishArtist      string
	EnglishYear        string
	EnglishMedium      string
	EnglishCollection  string
	EnglishDescription string
	EnglishAlt         string
	File               string
	Width              int
	Height             int
	Accent             string
	SVG                template.HTML `json:"-"`
}

type galleryCopy struct {
	Album, Tagline, Reinterpretation, Encounter, Medium, Collection, OneAtATime string
	Destination, FullAddress, Continue, Navigation, Seconds, Preview            string
	Pause, Resume, Paused, PausedStatus, ResumedStatus                          string
}

type galleryPageData struct {
	Language, Alias, Destination, Domain, Index, Total, WaitLabel string
	Interstitial                                                  bool
	Seconds                                                       int16
	Ratio                                                         float64
	Artwork                                                       galleryArtwork
	Copy                                                          galleryCopy
	Styles                                                        template.CSS
	Script                                                        template.JS
}

var (
	galleryArtworks = loadGalleryArtworks()
	galleryTemplate = template.Must(template.New("gallery").Parse(galleryAsset("page.html")))
	// These casts apply only to checked-in assets, never a URL or user content.
	galleryStyles = template.CSS(galleryAsset("gallery.css"))
	galleryScript = template.JS(galleryAsset("redirect.js"))
)

func galleryAsset(name string) string {
	content, err := galleryFiles.ReadFile("gallery/" + name)
	if err != nil {
		panic(err)
	}
	return string(content)
}

func loadGalleryArtworks() []galleryArtwork {
	var artworks []galleryArtwork
	if err := json.Unmarshal([]byte(galleryAsset("artworks.json")), &artworks); err != nil {
		panic(err)
	}
	if len(artworks) == 0 {
		panic("redirect gallery must include at least one artwork")
	}
	for i := range artworks {
		if artworks[i].Width <= 0 || artworks[i].Height <= 0 {
			panic("redirect gallery artwork must have positive dimensions")
		}
		// Each SVG is a trusted local illustration, not uploaded or remote HTML.
		artworks[i].SVG = template.HTML(galleryAsset(artworks[i].File))
	}
	return artworks
}

func previewPage(alias, destination, language string) string {
	return redirectPage(alias, destination, language, false, 0)
}

func interstitialPage(alias, destination string, seconds int16, language string) string {
	return redirectPage(alias, destination, language, true, seconds)
}

func redirectPage(alias, destination, language string, interstitial bool, seconds int16) string {
	index := rand.IntN(len(galleryArtworks))
	return renderGalleryPage(alias, destination, language, interstitial, seconds, galleryArtworks[index], index)
}

func renderGalleryPage(alias, destination, language string, interstitial bool, seconds int16, art galleryArtwork, index int) string {
	if language != langChinese {
		language = langEnglish
		art.Title, art.Artist, art.Year = art.EnglishTitle, art.EnglishArtist, art.EnglishYear
		art.Medium, art.Collection = art.EnglishMedium, art.EnglishCollection
		art.Description, art.Alt = art.EnglishDescription, art.EnglishAlt
	}
	if !interstitial {
		seconds = 0
	}
	domain := destination
	if parsed, err := url.Parse(destination); err == nil && parsed.Host != "" {
		// Host excludes credentials and includes the port, when one is present.
		domain = parsed.Host
	}
	data := galleryPageData{
		Language: language, Alias: alias, Destination: destination, Domain: domain,
		Index: fmt.Sprintf("%02d", index+1), Total: fmt.Sprintf("%02d", len(galleryArtworks)),
		WaitLabel:    interstitialWaitLabel(language, seconds),
		Interstitial: interstitial, Seconds: seconds, Ratio: float64(art.Width) / float64(art.Height),
		Artwork: art, Copy: galleryLabels(language), Styles: galleryStyles, Script: galleryScript,
	}
	var page bytes.Buffer
	if err := galleryTemplate.Execute(&page, data); err != nil {
		panic(err)
	}
	return page.String()
}

func galleryLabels(language string) galleryCopy {
	if language == langChinese {
		return galleryCopy{
			Album: "途中画册", Tagline: "在抵达之前，遇见一幅画。",
			Reinterpretation: "名画的像素演绎", Encounter: "此刻，与你相遇",
			Medium: "原作媒介", Collection: "原作馆藏", OneAtATime: "每次途经，偶遇一幅。",
			Destination: "即将前往", FullAddress: "查看完整目标地址", Continue: "立即前往",
			Navigation: "跳转信息", Seconds: "秒后自动跳转", Preview: "链接预览",
			Pause: "停留欣赏", Resume: "继续倒计时", Paused: "已暂停欣赏",
			PausedStatus: "倒计时已暂停，可以停留欣赏。", ResumedStatus: "倒计时已继续。",
		}
	}
	return galleryCopy{
		Album: "The passing gallery", Tagline: "A little art before you arrive.",
		Reinterpretation: "Masterpieces, reimagined in pixels", Encounter: "YOUR CHANCE ENCOUNTER",
		Medium: "Medium", Collection: "Collection", OneAtATime: "A different encounter along the way.",
		Destination: "YOUR DESTINATION", FullAddress: "View full destination address", Continue: "Continue now",
		Navigation: "Destination and navigation", Seconds: "seconds to go", Preview: "Link preview",
		Pause: "Stay a while", Resume: "Resume", Paused: "Take your time",
		PausedStatus: "Countdown paused. Take your time with the artwork.", ResumedStatus: "Countdown resumed.",
	}
}
